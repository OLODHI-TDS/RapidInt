        function editOrganizationMapping(org) {
            // Parse integrationCredentials if it's a JSON string
            let integrationCreds = {};
            if (typeof org.integrationCredentials === 'string') {
                try {
                    integrationCreds = JSON.parse(org.integrationCredentials);
                } catch (e) {
                    console.error('Failed to parse integrationCredentials:', e);
                }
            } else if (typeof org.integrationCredentials === 'object') {
                integrationCreds = org.integrationCredentials;
            }

            // Extract Alto credentials if present
            const altoAgencyRef = integrationCreds.alto?.agencyRef || '';
            const altoBranchId = integrationCreds.alto?.branchId || 'DEFAULT';

            // Create and show edit modal
            const modal = document.createElement('div');
            modal.className = 'edit-org-modal';
            modal.innerHTML = `
                <div class="edit-org-modal-content" style="max-width: 800px;">
                    <div class="edit-org-modal-header">
                        <h3>Edit Organization Mapping</h3>
                        <button class="close-modal" onclick="this.closest('.edit-org-modal').remove()">&times;</button>
                    </div>
                    <div class="edit-org-modal-body">
                        <!-- Store original identifiers -->
                        <input type="hidden" id="edit-originalOrgName" value="${org.organizationName || ''}">
                        <input type="hidden" id="edit-originalEnvironment" value="${org.environment || currentEnvironment}">

                        <!-- Organization Details -->
                        <h4 style="color: #2d3748; margin-bottom: 15px; font-size: 16px;">📋 Organization Details</h4>
                        <div class="form-group">
                            <label>Organization Name *</label>
                            <input type="text" id="edit-organizationName" value="${org.organizationName || ''}" placeholder="e.g., Demo Estate Agency">
                        </div>
                        <div class="form-group">
                            <label>Integration Type *</label>
                            <select id="edit-integrationType" onchange="toggleIntegrationFields('edit')">
                                <option value="alto" ${(org.integrationType || 'alto') === 'alto' ? 'selected' : ''}>Alto</option>
                                <option value="jupix" ${org.integrationType === 'jupix' ? 'selected' : ''}>Jupix (Coming Soon)</option>
                            </select>
                        </div>

                        <!-- Integration Credentials -->
                        <h4 style="color: #2d3748; margin: 25px 0 15px 0; font-size: 16px;">🔌 Integration Credentials</h4>
                        <div id="edit-integration-fields">
                            ${(org.integrationType || 'alto') === 'alto' ? `
                                <div class="form-group">
                                    <label>Alto Agency Reference *</label>
                                    <input type="text" id="edit-agencyRef" value="${altoAgencyRef}" placeholder="e.g., 1af89d60-662c-475b-bcc8-9bcbf04b6322">
                                </div>
                                <div class="form-group">
                                    <label>Alto Branch ID</label>
                                    <input type="text" id="edit-branchId" value="${altoBranchId}" placeholder="e.g., MAIN, NORTH, SOUTH (or DEFAULT)">
                                </div>
                            ` : `
                                <p style="color: #718096; font-style: italic;">Jupix integration fields coming soon...</p>
                            `}
                        </div>

                        <!-- Legacy TDS Configuration -->
                        <h4 style="color: #2d3748; margin: 25px 0 15px 0; font-size: 16px;">🏛️ Legacy TDS Configuration</h4>
                        <div class="form-group">
                            <label>Legacy Member ID *</label>
                            <input type="text" id="edit-legacyMemberId" value="${org.tdsLegacyConfig?.memberId || org.legacyMemberId || ''}" placeholder="e.g., 1960473">
                        </div>
                        <div class="form-group">
                            <label>Legacy Branch ID *</label>
                            <input type="text" id="edit-legacyBranchId" value="${org.tdsLegacyConfig?.branchId || org.legacyBranchId || ''}" placeholder="e.g., 1960473">
                        </div>
                        <div class="form-group">
                            <label>Legacy API Key *</label>
                            <input type="password" id="edit-legacyApiKey" placeholder="Leave blank to keep existing key">
                        </div>

                        <!-- Salesforce TDS Configuration -->
                        <h4 style="color: #2d3748; margin: 25px 0 15px 0; font-size: 16px;">☁️ Salesforce TDS Configuration</h4>
                        <div class="form-group">
                            <label>Authentication Method *</label>
                            <select id="edit-sfAuthMethod" onchange="toggleSalesforceAuthFields('edit')">
                                <option value="api_key" ${(org.tdsSalesforceConfig?.authMethod || org.sfAuthMethod || 'api_key') === 'api_key' ? 'selected' : ''}>API Key</option>
                                <option value="oauth2" ${(org.tdsSalesforceConfig?.authMethod || org.sfAuthMethod) === 'oauth2' ? 'selected' : ''}>OAuth2 (Client ID & Secret)</option>
                            </select>
                        </div>
                        <div id="edit-sf-apikey-fields" style="display: ${(org.tdsSalesforceConfig?.authMethod || org.sfAuthMethod || 'api_key') === 'api_key' ? 'block' : 'none'};">
                            <div class="form-group">
                                <label>Salesforce API Key *</label>
                                <input type="password" id="edit-sfApiKey" placeholder="Leave blank to keep existing key">
                            </div>
                        </div>
                        <div id="edit-sf-oauth-fields" style="display: ${(org.tdsSalesforceConfig?.authMethod || org.sfAuthMethod) === 'oauth2' ? 'block' : 'none'};">
                            <div class="form-group">
                                <label>Client ID *</label>
                                <input type="text" id="edit-sfClientId" value="${org.tdsSalesforceConfig?.clientId || org.sfClientId || ''}" placeholder="Salesforce Client ID">
                            </div>
                            <div class="form-group">
                                <label>Client Secret *</label>
                                <input type="password" id="edit-sfClientSecret" placeholder="Leave blank to keep existing secret">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Salesforce Member ID *</label>
                            <input type="text" id="edit-sfMemberId" value="${org.tdsSalesforceConfig?.memberId || org.sfMemberId || ''}" placeholder="e.g., 1960473">
                        </div>
                        <div class="form-group">
                            <label>Salesforce Branch ID *</label>
                            <input type="text" id="edit-sfBranchId" value="${org.tdsSalesforceConfig?.branchId || org.sfBranchId || ''}" placeholder="e.g., 1960473">
                        </div>
                        <div class="form-group">
                            <label>Region *</label>
                            <select id="edit-sfRegion">
                                <option value="EW" ${(org.tdsSalesforceConfig?.region || org.sfRegion || 'EW') === 'EW' ? 'selected' : ''}>England & Wales</option>
                                <option value="Scotland" ${(org.tdsSalesforceConfig?.region || org.sfRegion) === 'Scotland' ? 'selected' : ''}>Scotland</option>
                                <option value="NI" ${(org.tdsSalesforceConfig?.region || org.sfRegion) === 'NI' ? 'selected' : ''}>Northern Ireland</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Scheme Type *</label>
                            <select id="edit-sfSchemeType">
                                <option value="Custodial" ${(org.tdsSalesforceConfig?.schemeType || org.sfSchemeType || 'Custodial') === 'Custodial' ? 'selected' : ''}>Custodial</option>
                                <option value="Insured" ${(org.tdsSalesforceConfig?.schemeType || org.sfSchemeType) === 'Insured' ? 'selected' : ''}>Insured</option>
                            </select>
                        </div>

                        <!-- Provider Preference -->
                        <h4 style="color: #2d3748; margin: 25px 0 15px 0; font-size: 16px;">⚙️ System Configuration</h4>
                        <div class="form-group">
                            <label>Provider Preference *</label>
                            <select id="edit-provider">
                                <option value="current" ${(org.tdsProviderPreference || org.provider || 'current') === 'current' ? 'selected' : ''}>Legacy Only</option>
                                <option value="salesforce" ${(org.tdsProviderPreference || org.provider) === 'salesforce' ? 'selected' : ''}>Salesforce Only</option>
                                <option value="auto" ${(org.tdsProviderPreference || org.provider) === 'auto' ? 'selected' : ''}>Auto (Dual Mode)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Status *</label>
                            <select id="edit-isActive">
                                <option value="true" ${org.isActive !== false ? 'selected' : ''}>Active</option>
                                <option value="false" ${org.isActive === false ? 'selected' : ''}>Inactive</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button class="btn btn-secondary" onclick="this.closest('.edit-org-modal').remove()">Cancel</button>
                        <button class="btn btn-primary" onclick="saveOrganizationMapping()">Save Changes</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);
            document.getElementById('edit-organizationName').focus();
        }

        async function saveOrganizationMapping() {
            // Get original identifiers
            const originalOrgName = document.getElementById('edit-originalOrgName').value;
            const originalEnvironment = document.getElementById('edit-originalEnvironment').value;

            // Get updated values
            const integrationType = document.getElementById('edit-integrationType').value;
            const sfAuthMethod = document.getElementById('edit-sfAuthMethod').value;

            // Build integration credentials
            const integrationCredentials = {};
            if (integrationType === 'alto') {
                integrationCredentials.alto = {
                    agencyRef: document.getElementById('edit-agencyRef').value,
                    branchId: document.getElementById('edit-branchId').value || 'DEFAULT'
                };
            }

            // Build TDS configurations
            const tdsLegacyConfig = {
                memberId: document.getElementById('edit-legacyMemberId').value,
                branchId: document.getElementById('edit-legacyBranchId').value
            };

            const legacyApiKey = document.getElementById('edit-legacyApiKey').value;
            if (legacyApiKey.trim()) {
                tdsLegacyConfig.apiKey = legacyApiKey;
            }

            const tdsSalesforceConfig = {
                memberId: document.getElementById('edit-sfMemberId').value,
                branchId: document.getElementById('edit-sfBranchId').value,
                region: document.getElementById('edit-sfRegion').value,
                schemeType: document.getElementById('edit-sfSchemeType').value,
                authMethod: sfAuthMethod
            };

            if (sfAuthMethod === 'api_key') {
                const sfApiKey = document.getElementById('edit-sfApiKey').value;
                if (sfApiKey.trim()) {
                    tdsSalesforceConfig.apiKey = sfApiKey;
                }
            } else {
                const sfClientId = document.getElementById('edit-sfClientId').value;
                const sfClientSecret = document.getElementById('edit-sfClientSecret').value;
                if (sfClientId.trim()) {
                    tdsSalesforceConfig.clientId = sfClientId;
                }
                if (sfClientSecret.trim()) {
                    tdsSalesforceConfig.clientSecret = sfClientSecret;
                }
            }

            const data = {
                originalOrgName,
                originalEnvironment,
                organizationName: document.getElementById('edit-organizationName').value,
                environment: originalEnvironment,
                integrationType: integrationType,
                integrationCredentials: integrationCredentials,
                tdsLegacyConfig: tdsLegacyConfig,
                tdsSalesforceConfig: tdsSalesforceConfig,
                provider: document.getElementById('edit-provider').value,
                isActive: document.getElementById('edit-isActive').value === 'true'
            };

            // Validation
            if (!data.organizationName) {
                alert('Please enter an organization name');
                return;
            }

            if (integrationType === 'alto' && !integrationCredentials.alto.agencyRef) {
                alert('Please enter Alto Agency Reference');
                return;
            }

            if (!tdsLegacyConfig.memberId || !tdsLegacyConfig.branchId) {
                alert('Please fill in all Legacy TDS configuration fields');
                return;
            }

            if (!tdsSalesforceConfig.memberId || !tdsSalesforceConfig.branchId) {
                alert('Please fill in all Salesforce TDS configuration fields');
                return;
            }

            if (sfAuthMethod === 'api_key' && !tdsSalesforceConfig.apiKey && !document.getElementById('edit-sfApiKey').placeholder.includes('Leave blank')) {
                alert('Please enter Salesforce API Key');
                return;
            }

            if (sfAuthMethod === 'oauth2' && !tdsSalesforceConfig.clientId && !tdsSalesforceConfig.clientSecret && !document.getElementById('edit-sfClientSecret').placeholder.includes('Leave blank')) {
                alert('Please enter Salesforce Client ID and Client Secret');
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/organization/update`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    alert('Organization mapping updated successfully!');
                    document.querySelector('.edit-org-modal').remove();
                    refreshData(); // Refresh the main organizations table
                } else {
                    alert(result.error || 'Failed to update organization mapping');
                }
            } catch (error) {
                console.error('Error updating organization mapping:', error);
                alert('Error updating organization mapping');
            }
        }
