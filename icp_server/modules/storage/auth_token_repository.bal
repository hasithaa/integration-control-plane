// Copyright (c) 2025, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
//
// WSO2 Inc. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
//  http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import icp_server.types as types;

import ballerina/log;
import ballerina/sql;
import ballerina/time;

// Store a new refresh token in the database
public isolated function storeRefreshToken(string tokenId, string userId, string tokenHash, int expirySeconds, string? userAgent,
        string? ipAddress) returns error? {
    log:printDebug(string `Storing refresh token for user: ${userId}`);

    // Calculate expiry time in Ballerina by adding seconds to current time
    time:Utc currentTime = time:utcNow();
    decimal expiryEpoch = <decimal>currentTime[0] + <decimal>expirySeconds;
    time:Utc expiryUtc = [<int>expiryEpoch, currentTime[1]];
    string expiryUtcStr = check convertUtcToDbDateTime(expiryUtc);

    sql:ParameterizedQuery insertQuery = sql:queryConcat(
            `INSERT INTO refresh_tokens (token_id, user_id, token_hash, expires_at, user_agent, ip_address) 
         VALUES (${tokenId}, ${userId}, ${tokenHash}, `, sql:queryConcat(sqlQueryFromString(timestampCast(expiryUtcStr)), `, ${userAgent}, ${ipAddress})`)
    );
    sql:ExecutionResult|sql:Error result = dbClient->execute(insertQuery);

    if result is sql:Error {
        log:printError(string `Failed to store refresh token for user ${userId}`, 'error = result);
        match classifySqlError(result) {
            DUPLICATE_KEY => { return error("A refresh token with this ID already exists", result); }
            _ => { return error("An unexpected error occurred. Please contact your administrator.", result); }
        }
    }

    log:printInfo(string `Successfully stored refresh token for user ${userId}`);
    return ();
}

// Validate a refresh token and return user details if valid
public isolated function validateRefreshToken(string tokenHash) returns types:User|error {
    log:printDebug("Validating refresh token");

    // Query for the refresh token with seconds remaining until expiry
    // Use dialect-specific TIMESTAMPDIFF to avoid UNIX_TIMESTAMP compatibility issues with H2.
    // expires_at is inserted as an explicit UTC value, so compare against UTC rather than
    // CURRENT_TIMESTAMP, which the database server evaluates in its own timezone.
    string nowUtc = check utcNowSqlLiteral();
    sql:ParameterizedQuery selectQuery = sql:queryConcat(
        `SELECT token_id, user_id, revoked, `,
        sql:queryConcat(
            sqlQueryFromString(getTimestampDiffSeconds(nowUtc, "expires_at")),
            ` as seconds_until_expiry FROM refresh_tokens WHERE token_hash = ${tokenHash}`
        )
    );
    record {|
        string token_id;
        string user_id;
        boolean revoked;
        int seconds_until_expiry;
    |}|sql:Error refreshToken;
    if isOracle() {
        // Oracle: NUMBER(1) cannot map to a boolean field — read as int and convert
        record {|
            string token_id;
            string user_id;
            int revoked;
            int seconds_until_expiry;
        |}|sql:Error oraRow = dbClient->queryRow(selectQuery);
        if oraRow is sql:Error {
            refreshToken = oraRow;
        } else {
            refreshToken = {
                token_id: oraRow.token_id,
                user_id: oraRow.user_id,
                revoked: oraRow.revoked == 1,
                seconds_until_expiry: oraRow.seconds_until_expiry
            };
        }
    } else {
        refreshToken = dbClient->queryRow(selectQuery);
    }

    if refreshToken is sql:Error {
        if refreshToken is sql:NoRowsError {
            log:printWarn("Refresh token not found in database");
            return error("Invalid refresh token");
        } 
        log:printError("Database error while validating refresh token", 'error = refreshToken);
        return error("Invalid refresh token");
    }

    // Check if token is revoked
    if refreshToken.revoked {
        log:printWarn("Refresh token has been revoked", tokenId = refreshToken.token_id);
        return error("Refresh token has been revoked");
    }

    // Check if token has expired (seconds_until_expiry <= 0 means expired)
    if refreshToken.seconds_until_expiry <= 0 {
        log:printWarn("Refresh token has expired", tokenId = refreshToken.token_id);
        return error("Refresh token has expired");
    }

    // Update last_used_at timestamp
    sql:ExecutionResult|sql:Error updateResult = dbClient->execute(
        `UPDATE refresh_tokens 
         SET last_used_at = CURRENT_TIMESTAMP 
         WHERE token_hash = ${tokenHash}`
        );

    if updateResult is sql:Error {
        log:printWarn("Failed to update last_used_at for refresh token", updateResult);
    }

    // Fetch and return user details
    types:User|error user = getUserDetailsById(refreshToken.user_id);
    if user is error {
        log:printError(string `Failed to get user details for token validation`, user);
        return error("User not found for refresh token");
    }

    log:printInfo("Refresh token validated successfully", userId = user.userId);
    return user;
}

// Revoke a refresh token (logout)
public isolated function revokeRefreshToken(string tokenHash) returns error? {
    log:printDebug("Revoking refresh token");

    sql:ParameterizedQuery updateQuery = sql:queryConcat(
            `UPDATE refresh_tokens 
         SET revoked = `, sql:queryConcat(sqlQueryFromString(TRUE_LITERAL), `, revoked_at = CURRENT_TIMESTAMP 
         WHERE token_hash = ${tokenHash}`)
    );
    sql:ExecutionResult|sql:Error result = dbClient->execute(updateQuery);

    if result is sql:Error {
        log:printError("Failed to revoke refresh token", 'error = result);
        return error("An unexpected error occurred. Please contact your administrator.", result);
    }

    int? affectedRows = result.affectedRowCount;
    if affectedRows is () || affectedRows == 0 {
        log:printWarn("No refresh token found to revoke");
        return error("Refresh token not found");
    }

    log:printInfo("Successfully revoked refresh token");
    return ();
}

// Revoke all refresh tokens for a specific user
public isolated function revokeAllUserRefreshTokens(string userId) returns error? {
    log:printDebug(string `Revoking all refresh tokens for user: ${userId}`);

    sql:ParameterizedQuery updateQuery = sql:queryConcat(
            `UPDATE refresh_tokens 
         SET revoked = `, sql:queryConcat(sqlQueryFromString(TRUE_LITERAL),
                    sql:queryConcat(`, revoked_at = CURRENT_TIMESTAMP 
         WHERE user_id = ${userId} AND revoked = `, sqlQueryFromString(FALSE_LITERAL)))
    );
    sql:ExecutionResult|sql:Error result = dbClient->execute(updateQuery);

    if result is sql:Error {
        log:printError(string `Failed to revoke refresh tokens for user ${userId}`, 'error = result);
        return error("An unexpected error occurred. Please contact your administrator.", result);
    }

    int? affectedRows = result.affectedRowCount;
    log:printInfo(string `Successfully revoked ${affectedRows ?: 0} refresh tokens for user ${userId}`);
    return ();
}

// Clean up expired refresh tokens (called by scheduled job)
public isolated function cleanupExpiredRefreshTokens() returns error? {
    log:printDebug("Cleaning up expired refresh tokens");

    // expires_at holds UTC, so compare against UTC rather than CURRENT_TIMESTAMP
    string nowUtc = check utcNowSqlLiteral();
    sql:ParameterizedQuery deleteQuery = sql:queryConcat(
            `DELETE FROM refresh_tokens
         WHERE expires_at < `, sqlQueryFromString(nowUtc), ` OR revoked = `, sqlQueryFromString(TRUE_LITERAL)
    );
    sql:ExecutionResult|sql:Error result = dbClient->execute(deleteQuery);

    if result is sql:Error {
        log:printError("Failed to cleanup expired refresh tokens", 'error = result);
        return error("An unexpected error occurred. Please contact your administrator.", result);
    }

    int? deletedCount = result.affectedRowCount;
    log:printInfo(string `Successfully cleaned up ${deletedCount ?: 0} expired/revoked refresh tokens`);
    return ();
}
