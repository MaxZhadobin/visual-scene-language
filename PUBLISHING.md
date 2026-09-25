# Publishing Guide for @thinkingos/vsl-* Packages

This document provides step-by-step instructions for publishing `@thinkingos/vsl-sdk` and `@thinkingos/vsl-mcp-server` packages to npm. Designed for AI agents and developers without prior context.

## Table of Contents
- [Prerequisites](#prerequisites)
- [npm Organization Setup](#npm-organization-setup)
- [Authentication Token Setup](#authentication-token-setup)
- [Pre-Publishing Checklist](#pre-publishing-checklist)
- [Publishing Process](#publishing-process)
- [Version Management](#version-management)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools
- **Node.js >= 18**: Check with `node --version`
- **npm >= 9**: Check with `npm --version`
- **Git**: For version control

### Package Structure
visual-scene-language/
├── package.json                    # @thinkingos/vsl-sdk (root package)
├── packages/
│   └── mcp-server/
│       └── package.json            # @thinkingos/vsl-mcp-server
### Current Package Versions
- `@thinkingos/vsl-sdk`: 0.1.0
- `@thinkingos/vsl-mcp-server`: 0.1.0

---

## npm Organization Setup

### Organization Name
The npm organization is **`@thinkingos`** (NOT `@vsl` or any other scope).

### Verification
Before publishing, verify the organization exists:
npm view @thinkingos/vsl-sdk
If it returns package info, the organization exists. If 404, the organization needs to be created on npmjs.com.

### Creating a New Organization (if needed)
1. Go to https://www.npmjs.com/org/create
2. Organization name: `thinkingos`
3. Choose plan (Free tier is sufficient for public packages)
4. Complete setup

---

## Authentication Token Setup

### Critical Requirement
**The npm token MUST have "Bypass two-factor authentication for automation" enabled.** Without this flag, `npm publish` will return 403 Forbidden even with a valid token.

### Creating a Granular Access Token
1. Go to https://www.npmjs.com/settings/~/tokens
2. Click **"Generate New Token"** → **"Granular Access Token"**
3. Configure token:
   - **Token name**: `vsl-publishing` (or descriptive name)
   - **Expiration**: 365 days (or as needed)
   - **Packages and scopes**: 
     - Select **"Read and write"**
     - Scope: `@thinkingos` (or "All packages")
   - **Organization access**:
     - Select **"Read and write"** for `@thinkingos`
   - **⚠️ CRITICAL**: Enable **"Bypass two-factor authentication for automation"**
4. Click **"Generate Token"**
5. **Copy the token immediately** — it won't be shown again

### Setting the Token
Add the token to your npm configuration:
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN_HERE
Or add to `~/.npmrc`:
//registry.npmjs.org/:_authToken=YOUR_TOKEN_HERE
### Verifying Authentication
npm whoami
Expected output: `maxzhadobin` (or your npm username)

---

## Pre-Publishing Checklist

Before publishing, ensure:

- [ ] **All tests pass**: `npm test` and `cd packages/mcp-server && npm test`
- [ ] **Build succeeds**: `npm run build` and `cd packages/mcp-server && npm run build`
- [ ] **No uncommitted changes**: `git status` should be clean
- [ ] **Version numbers updated** (if needed): See [Version Management](#version-management)
- [ ] **Dependencies are correct**: 
  - `packages/mcp-server/package.json` must have `"@thinkingos/vsl-sdk": "^0.1.0"` (NOT `file:../..`)
- [ ] **npm authentication works**: `npm whoami` returns your username
- [ ] **Token has bypass 2FA enabled**: Critical for automation

### Dependency Check
The MCP server package depends on the SDK. Before publishing:

# Check current dependency
grep -A2 '"@thinkingos/vsl-sdk"' packages/mcp-server/package.json
Expected:
"dependencies": {
  "@thinkingos/vsl-sdk": "^0.1.0",
  ...
}
**NOT** `file:../..` (local path) — this must be changed to a version number before publishing.

---

## Publishing Process

### Step 1: Build Both Packages

Build the SDK first (root package):
npm run build
Expected output:
✓ dist/index.js      (CJS)
✓ dist/index.mjs     (ESM)
✓ dist/index.d.ts    (Types)
Then build the MCP server:
cd packages/mcp-server
npm run build
Expected output:
✓ dist/index.js      (ESM)
✓ dist/index.d.ts    (Types)
### Step 2: Publish SDK First

The SDK must be published **before** the MCP server (since MCP server depends on SDK).

From the **root directory**:
npm publish --access public
Expected output:
+ @thinkingos/vsl-sdk@0.1.0
### Step 3: Publish MCP Server

From the **MCP server directory**:
cd packages/mcp-server
npm publish --access public
Expected output:
+ @thinkingos/vsl-mcp-server@0.1.0
### Step 4: Verify Publication

Check that packages are available on npm:
npm view @thinkingos/vsl-sdk
npm view @thinkingos/vsl-mcp-server
Both should return package metadata.

---

## Version Management

### Semantic Versioning
Follow [semver](https://semver.org/):
- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.2.0): New features, backwards compatible
- **PATCH** (0.1.1): Bug fixes

### Updating Version Numbers

#### Option 1: Manual Update
Edit `package.json` files:
{
  "name": "@thinkingos/vsl-sdk",
  "version": "0.2.0",  // Update here
  ...
}
And update dependency in `packages/mcp-server/package.json`:
{
  "dependencies": {
    "@thinkingos/vsl-sdk": "^0.2.0",  // Match the new version
    ...
  }
}
#### Option 2: npm version Command
# From root (SDK)
npm version patch  # 0.1.0 → 0.1.1
npm version minor  # 0.1.0 → 0.2.0
npm version major  # 0.1.0 → 1.0.0

# From packages/mcp-server
cd packages/mcp-server
npm version patch
**Note**: `npm version` creates a git commit and tag. You may need to push:
git push && git push --tags
### Publishing a New Version

1. Update version numbers (see above)
2. Build both packages: `npm run build` and `cd packages/mcp-server && npm run build`
3. Publish SDK: `npm publish --access public` (from root)
4. Publish MCP server: `cd packages/mcp-server && npm publish --access public`

---

## Troubleshooting

### Error: 403 Forbidden

**Cause**: Token lacks "Bypass two-factor authentication for automation" flag.

**Solution**:
1. Go to https://www.npmjs.com/settings/~/tokens
2. Delete the current token
3. Create a new Granular Access Token with **"Bypass two-factor authentication for automation"** enabled
4. Update `~/.npmrc` with the new token
5. Retry `npm publish`

### Error: 404 Not Found

**Cause**: The organization/scope doesn't exist on npm.

**Solution**:
1. Verify organization name: `npm view @thinkingos/vsl-sdk`
2. If 404, create the organization at https://www.npmjs.com/org/create
3. Organization name must be `thinkingos` (without @)

### Error: Cannot publish over previously published version

**Cause**: Version number already exists on npm.

**Solution**:
1. Bump version: `npm version patch` (or manually edit `package.json`)
2. Rebuild: `npm run build`
3. Republish: `npm publish --access public`

### Error: Dependency @thinkingos/vsl-sdk@file:../.. not found

**Cause**: MCP server still has local file path instead of npm version.

**Solution**:
1. Edit `packages/mcp-server/package.json`:
      "dependencies": {
     "@thinkingos/vsl-sdk": "^0.1.0"  // Change from file:../..
   }
   2. Rebuild MCP server: `cd packages/mcp-server && npm run build`
3. Republish: `npm publish --access public`

### Error: npm ERR! You must be logged in

**Cause**: No authentication token configured.

**Solution**:
npm login
# Or set token directly:
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN
### Build Errors

**Cause**: TypeScript compilation errors or missing dependencies.

**Solution**:
# Install dependencies
npm install

# Check TypeScript errors
npm run typecheck

# Fix errors and rebuild
npm run build
---

## Quick Reference

### Common Commands

# Check authentication
npm whoami

# Build SDK
npm run build

# Build MCP server
cd packages/mcp-server && npm run build

# Publish SDK (from root)
npm publish --access public

# Publish MCP server
cd packages/mcp-server && npm publish --access public

# Verify publication
npm view @thinkingos/vsl-sdk
npm view @thinkingos/vsl-mcp-server

# Update version (patch)
npm version patch

# Update version (minor)
npm version minor
### Publishing Workflow Summary

1. ✅ Verify authentication: `npm whoami`
2. ✅ Build SDK: `npm run build`
3. ✅ Build MCP server: `cd packages/mcp-server && npm run build`
4. ✅ Publish SDK: `npm publish --access public` (from root)
5. ✅ Publish MCP server: `cd packages/mcp-server && npm publish --access public`
6. ✅ Verify: `npm view @thinkingos/vsl-sdk` and `npm view @thinkingos/vsl-mcp-server`

---

## Important Notes

### Scope Name
- **Correct**: `@thinkingos/vsl-sdk`, `@thinkingos/vsl-mcp-server`
- **Incorrect**: `@vsl/sdk`, `@vsl/mcp-server` (old scope, does not exist)

### Access Level
- Always use `--access public` for scoped packages
- Without this flag, scoped packages default to restricted (private)

### Token Security
- Never commit tokens to git
- Use environment variables or `~/.npmrc` (which should be in `.gitignore`)
- Rotate tokens periodically (recommended: every 90-365 days)

### Local Development vs Published Packages
- During local development, you can use `file:../..` for dependencies
- **Before publishing**, change to version number (e.g., `^0.1.0`)
- After publishing, the version on npm will be used by consumers

---

## Support

For issues or questions:
- npm documentation: https://docs.npmjs.com/
- npm support: https://www.npmjs.com/support
- Project repository: Check `package.json` for repository URL

---

**Last updated**: 2026-09-25  
**Current versions**: @thinkingos/vsl-sdk@0.1.0, @thinkingos/vsl-mcp-server@0.1.0