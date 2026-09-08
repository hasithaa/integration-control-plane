// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
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

import ballerina/jballerina.java;

// ballerina/uuid and ballerina/random (its transitive dependency) generate randomness
// using java.util.Random, which is a predictable, non-cryptographic PRNG - not suitable
// for session tokens, secrets, or key material. Use the functions below - backed by
// java.security.SecureRandom - for any security-sensitive value instead.

final string[] & readonly hexDigits = [
    "0", "1", "2", "3", "4", "5", "6", "7",
    "8", "9", "a", "b", "c", "d", "e", "f"
];

isolated function newSecureRandom() returns handle = @java:Constructor {
    'class: "java.security.SecureRandom"
} external;

isolated function secureRandomNextLong(handle randomObj) returns int = @java:Method {
    name: "nextLong",
    'class: "java.util.Random"
} external;

# Returns `numBytes` cryptographically secure random bytes.
#
# + numBytes - the number of random bytes to return
# + return - a byte array of exactly `numBytes` cryptographically secure random bytes
public isolated function secureRandomBytes(int numBytes) returns byte[] {
    if numBytes < 0 {
        panic error(string `numBytes must be non-negative, found ${numBytes}`);
    }
    handle randomObj = newSecureRandom();
    byte[] result = [];
    int longsNeeded = (numBytes + 7) / 8;
    foreach int i in 0 ..< longsNeeded {
        int val = secureRandomNextLong(randomObj);
        result.push(<byte>((val >> 56) & 0xff));
        result.push(<byte>((val >> 48) & 0xff));
        result.push(<byte>((val >> 40) & 0xff));
        result.push(<byte>((val >> 32) & 0xff));
        result.push(<byte>((val >> 24) & 0xff));
        result.push(<byte>((val >> 16) & 0xff));
        result.push(<byte>((val >> 8) & 0xff));
        result.push(<byte>(val & 0xff));
    }
    return result.slice(0, numBytes);
}

# Returns a lowercase hex-encoded string of `numBytes` cryptographically secure random bytes.
#
# + numBytes - the number of random bytes to encode
# + return - a `numBytes * 2`-character lowercase hex string
public isolated function secureRandomHex(int numBytes) returns string {
    byte[] randomBytes = secureRandomBytes(numBytes);
    string hex = "";
    foreach byte b in randomBytes {
        int v = <int>b;
        hex += hexDigits[(v >> 4) & 0xf] + hexDigits[v & 0xf];
    }
    return hex;
}

# Returns a UUIDv4-shaped string (RFC 4122, `8-4-4-4-12` hex) filled with cryptographically
# secure randomness. Use this in place of ballerina/uuid's createType4AsString() wherever the
# UUIDv4 format must be preserved (e.g. an existing format check or a UUID-typed DB column).
#
# + return - a UUIDv4-formatted string
public isolated function secureRandomUuidV4() returns string {
    byte[] b = secureRandomBytes(16);
    // Set the version (0100) and variant (10xx) bits per RFC 4122 section 4.4.
    b[6] = <byte>((b[6] & 0x0f) | 0x40);
    b[8] = <byte>((b[8] & 0x3f) | 0x80);

    string hex = "";
    foreach byte x in b {
        int v = <int>x;
        hex += hexDigits[(v >> 4) & 0xf] + hexDigits[v & 0xf];
    }
    return string `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}
