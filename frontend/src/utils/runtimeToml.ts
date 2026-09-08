/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * The `main.bal` imports a BI runtime needs. The ICP bridge import is all of it: when the
 * integration uses ballerina/workflow, the bridge's compiler plugin generates the wiring that
 * publishes workflow metadata and executes ICP-tunneled management commands, and the bridge
 * advertises that capability by itself — no workflow.management import, management REST API,
 * API key, or opt-in flag is involved. Shared by the Add Runtime dialogs.
 */
export function runtimeImports(): string {
  return 'import wso2/icp.runtime.bridge as _;';
}
