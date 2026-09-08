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

import ballerina/test;
import icp_server.utils;

// Test: secureRandomBytes returns the requested number of bytes
@test:Config {
    groups: ["utils"]
}
function testSecureRandomBytesLength() {
    byte[] result = utils:secureRandomBytes(32);
    test:assertEquals(result.length(), 32, "secureRandomBytes(32) should return 32 bytes");
}

// Test: secureRandomBytes rejects a negative length instead of panicking on an
// out-of-range slice
@test:Config {
    groups: ["utils"]
}
function testSecureRandomBytesRejectsNegativeInput() {
    byte[]|error result = trap utils:secureRandomBytes(-1);
    test:assertTrue(result is error, "secureRandomBytes(-1) should be rejected, not panic on an out-of-range slice");
}
