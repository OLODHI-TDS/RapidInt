# Azure AD / Microsoft SSO Setup Guide

This guide walks you through configuring Microsoft Single Sign-On (Azure AD authentication) for the Alto Jupix Integration project.

## Overview

The application uses **Azure AD (Microsoft Entra ID)** to authenticate users and control access to sensitive data. This ensures:

✅ **Secure authentication** - Users log in with their Microsoft 365 credentials
✅ **Role-based access control** - Admins can decrypt PII, viewers cannot
✅ **Audit logging** - Track who accessed what data and when (GDPR Article 30)
✅ **Seamless integration** - Works locally and in Azure Functions

---

## Prerequisites

- **Azure subscription** (if you don't have one, create a free account at https://azure.microsoft.com/free/)
- **Azure AD tenant** (most organizations already have this with Microsoft 365)
- **Global Administrator** or **Application Administrator** role in Azure AD
- **Node.js** and **npm** installed locally

---

## Part 1: Create Azure AD App Registration

### Step 1: Navigate to Azure Portal

1. Go to https://portal.azure.com
2. Sign in with your admin account
3. Search for **"Azure Active Directory"** in the top search bar
4. Click on **"Azure Active Directory"**

### Step 2: Create App Registration

1. In the left sidebar, click **"App registrations"**
2. Click **"+ New registration"** at the top
3. Fill in the registration form:

   **Name**: `Alto Jupix Integration (Development)`
   **Supported account types**: `Accounts in this organizational directory only (Single tenant)`
   **Redirect URI**:
   - Platform: **Web**
   - URI: `http://localhost:7071/api/auth/callback`

4. Click **"Register"**

### Step 3: Copy Application (Client) ID and Tenant ID

After registration, you'll see the app overview page:

1. Copy the **Application (client) ID** - this is your `AZURE_AD_CLIENT_ID`
2. Copy the **Directory (tenant) ID** - this is your `AZURE_AD_TENANT_ID`

**Save these values** - you'll need them for the environment configuration.

### Step 4: Create Client Secret

1. In the left sidebar, click **"Certificates & secrets"**
2. Click **"+ New client secret"**
3. Add a description: `Local Development Secret`
4. Choose expiration: **24 months** (or your organization's policy)
5. Click **"Add"**
6. **⚠️ IMPORTANT**: Copy the **Value** (not the Secret ID) immediately
   - This is your `AZURE_AD_CLIENT_SECRET`
   - You can't see it again after leaving this page!

### Step 5: Configure API Permissions

1. In the left sidebar, click **"API permissions"**
2. You should see `Microsoft Graph > User.Read` (delegated) - this is added by default
3. Click **"+ Add a permission"**
4. Click **"Microsoft Graph"**
5. Click **"Delegated permissions"**
6. Add the following permissions:
   - ✅ `email`
   - ✅ `openid`
   - ✅ `profile`
   - ✅ `User.Read`
7. Click **"Add permissions"**
8. Click **"Grant admin consent for [Your Organization]"** (requires admin)
9. Click **"Yes"** to confirm

### Step 6: Configure App Roles (for RBAC)

App roles allow you to assign users to specific roles (admin, support, viewer).

1. In the left sidebar, click **"App roles"**
2. Click **"+ Create app role"**
3. Create **Admin Role**:
   - **Display name**: `Admin`
   - **Allowed member types**: `Users/Groups`
   - **Value**: `admin`
   - **Description**: `Full access - can view and decrypt all PII`
   - **Enable this app role**: ✅ Checked
   - Click **"Apply"**

4. Create **Support Role**:
   - **Display name**: `Support`
   - **Allowed member types**: `Users/Groups`
   - **Value**: `support`
   - **Description**: `Support access - can view and decrypt PII for troubleshooting`
   - **Enable this app role**: ✅ Checked
   - Click **"Apply"**

5. Create **Viewer Role**:
   - **Display name**: `Viewer`
   - **Allowed member types**: `Users/Groups`
   - **Value**: `viewer`
   - **Description**: `Read-only access - cannot decrypt PII`
   - **Enable this app role**: ✅ Checked
   - Click **"Apply"**

---

## Part 2: Assign Users to Roles

### Step 1: Navigate to Enterprise Applications

1. In Azure Portal, search for **"Enterprise applications"**
2. Click on **"Enterprise applications"**
3. Find and click on **"Alto Jupix Integration (Development)"**

### Step 2: Assign Users to Roles

1. In the left sidebar, click **"Users and groups"**
2. Click **"+ Add user/group"**
3. Click **"Users"**, select yourself (or other users)
4. Click **"Select"**
5. Click **"Select a role"**
6. Choose **"Admin"** role (for yourself)
7. Click **"Select"**
8. Click **"Assign"**

**Repeat** for other users, assigning appropriate roles.

---

## Part 3: Configure Local Development Environment

### Step 1: Update .env.local File

Open `azure-functions/.env.local` and add your Azure AD configuration:

```bash
# Azure AD Authentication
AZURE_AD_TENANT_ID=your-tenant-id-from-step-3
AZURE_AD_CLIENT_ID=your-client-id-from-step-3
AZURE_AD_CLIENT_SECRET=your-client-secret-from-step-4
AZURE_AD_REDIRECT_URI=http://localhost:7071/api/auth/callback
```

**Example**:
```bash
AZURE_AD_TENANT_ID=12345678-1234-1234-1234-123456789abc
AZURE_AD_CLIENT_ID=87654321-4321-4321-4321-cba987654321
AZURE_AD_CLIENT_SECRET=ABC~xyz123abc456def789ghi012jkl345mno678pqr
AZURE_AD_REDIRECT_URI=http://localhost:7071/api/auth/callback
```

### Step 2: Verify Configuration

Start your Azure Functions locally:

```bash
cd azure-functions
npm start
```

You should see log messages indicating Azure AD is configured:
```
[AUTH] Azure AD configured - authentication enabled
```

---

## Part 4: Test Authentication Locally

### Step 1: Open Test Bench

1. Start Azure Functions: `npm start`
2. Open browser: `http://localhost:7071/tools/test-bench.html`

### Step 2: Login with Microsoft

1. Click **"Login with Microsoft"** button (once implemented)
2. You'll be redirected to Microsoft login page
3. Sign in with your O365 credentials
4. Grant consent to the application (first time only)
5. You'll be redirected back to the test bench
6. You should see: `Logged in as: your.name@company.com`

### Step 3: Test PII Decryption

1. Create a test deposit (generates encrypted audit logs)
2. View audit logs in test bench
3. Encrypted PII should be automatically decrypted (if you have admin/support role)
4. Check browser console for audit logs:
   ```
   [AUDIT] {"event":"pii_decrypted","user":"your.name@company.com","authenticated":true}
   ```

---

## Part 5: Production Deployment

### Step 1: Create Production App Registration

Repeat **Part 1** but with production values:

- **Name**: `Alto Jupix Integration (Production)`
- **Redirect URI**: `https://your-function-app.azurewebsites.net/api/auth/callback`

### Step 2: Configure Azure Functions App Settings

In Azure Portal:

1. Navigate to your Function App
2. Click **"Configuration"** (under Settings)
3. Add the following Application settings:
   - `AZURE_AD_TENANT_ID`
   - `AZURE_AD_CLIENT_ID`
   - `AZURE_AD_CLIENT_SECRET` (mark as **Key Vault reference** for security)
   - `AZURE_AD_REDIRECT_URI`
   - `NODE_ENV=production`

4. Click **"Save"**
5. Restart Function App

### Step 3: Configure Managed Identity (Recommended)

For production, use Managed Identity instead of client secret:

1. In Function App, click **"Identity"** (under Settings)
2. Under **System assigned**, set **Status** to **On**
3. Click **"Save"**
4. Go back to your App Registration in Azure AD
5. Under **"Certificates & secrets"**, delete the client secret
6. Under **"Authentication"**, enable **"Access tokens"** and **"ID tokens"**

---

## Part 6: Role-Based Access Control

### Understanding Roles

| Role | Can Login | Can View Audit Logs | Can Decrypt PII | Can Modify Settings |
|------|-----------|---------------------|-----------------|---------------------|
| **Admin** | ✅ | ✅ | ✅ | ✅ |
| **Support** | ✅ | ✅ | ✅ (limited) | ❌ |
| **Viewer** | ✅ | ✅ | ❌ | ❌ |

### How RBAC Works

1. **User logs in** → Azure AD issues JWT token with user roles
2. **Application validates token** → Extracts user email and roles
3. **User requests PII** → Application checks if user has `admin` or `support` role
4. **Decryption authorized** → PII decrypted and shown to user
5. **Audit log created** → Action logged with user email and timestamp

### Denying Access Example

If a user with `viewer` role tries to decrypt PII:

```json
{
  "success": false,
  "error": "Insufficient permissions to decrypt PII",
  "message": "Required role(s): admin, support",
  "timestamp": "2025-10-13T10:30:00Z"
}
```

---

## Troubleshooting

### Issue: "AADSTS50011: The redirect URI does not match"

**Solution**: Verify redirect URI in Azure AD exactly matches your environment:
- Local: `http://localhost:7071/api/auth/callback`
- Production: `https://your-app.azurewebsites.net/api/auth/callback`

### Issue: "AADSTS65001: User or administrator has not consented"

**Solution**:
1. Go to App Registration > API permissions
2. Click **"Grant admin consent for [Organization]"**

### Issue: "Token validation failed: Invalid signature"

**Solution**:
1. Check `AZURE_AD_TENANT_ID` is correct
2. Ensure token is fresh (not expired)
3. Verify system clock is synchronized

### Issue: "No roles in token"

**Solution**:
1. Verify user is assigned to a role in Enterprise Applications
2. Check app roles are published (App Registration > App roles)
3. User may need to log out and log back in for roles to refresh

### Issue: "PII decryption denied in development mode"

**Solution**:
- Development mode uses mock user with automatic `admin` role
- Verify `NODE_ENV=development` in `.env.local`
- Check PII encryption module logs for details

---

## Security Best Practices

### ✅ DO:
- ✅ Use **Managed Identity** in production (no secrets in code)
- ✅ Rotate client secrets every **6-12 months**
- ✅ Use **Key Vault** to store client secrets (not app settings)
- ✅ Enable **Conditional Access** policies (require MFA, trusted locations)
- ✅ Monitor **Sign-in logs** in Azure AD for suspicious activity
- ✅ Regularly review **App permissions** (principle of least privilege)
- ✅ Enable **audit logging** for all PII access

### ❌ DON'T:
- ❌ Commit secrets to git (use `.env.local`, add to `.gitignore`)
- ❌ Share client secrets via email/Slack
- ❌ Give all users `admin` role (use least privilege)
- ❌ Disable token validation in production
- ❌ Log decrypted PII data
- ❌ Use client secrets in production (use managed identity)

---

## Additional Resources

- [Azure AD Documentation](https://docs.microsoft.com/azure/active-directory/)
- [MSAL Node.js Documentation](https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/lib/msal-node)
- [Azure Functions Authentication](https://docs.microsoft.com/azure/azure-functions/functions-bindings-http-webhook-trigger#working-with-client-identities)
- [GDPR Compliance Guide](https://docs.microsoft.com/compliance/regulatory/gdpr)

---

## Support

If you encounter issues:

1. Check **Azure Functions logs** for authentication errors
2. Check **Azure AD Sign-in logs** in Azure Portal
3. Enable **verbose logging** in `auth-middleware.js` (set `logLevel: msal.LogLevel.Verbose`)
4. Review **audit logs** for PII decryption attempts

For additional help, contact your Azure administrator.
