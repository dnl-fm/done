# 🚀 Deployment Setup Guide

This guide explains how to set up GitHub workflows for automated CI/CD with Deno Deploy.

## 📋 Prerequisites

1. **GitHub Repository** with admin access
2. **Deno Deploy Account** ([signup](https://deno.com/deploy))
3. **Turso Account** for production database ([signup](https://turso.tech))

## 🔐 Required Secrets

Configure these secrets in your GitHub repository settings (`Settings > Secrets and variables > Actions`):

### **Repository Secrets**

```bash
# Deno Deploy Integration
DENO_DEPLOY_TOKEN=ddp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Production Environment
PRODUCTION_AUTH_TOKEN=your-secure-production-auth-token-here
PRODUCTION_TURSO_DB_URL=libsql://your-database-url.turso.io
PRODUCTION_TURSO_DB_AUTH_TOKEN=your-turso-auth-token-here
PRODUCTION_TEST_TOKEN=token-for-post-deployment-testing

# Staging Environment  
STAGING_AUTH_TOKEN=your-staging-auth-token-here
STAGING_TURSO_DB_URL=libsql://your-staging-database-url.turso.io
STAGING_TURSO_DB_AUTH_TOKEN=your-staging-turso-auth-token-here

# Preview Environment
PREVIEW_AUTH_TOKEN=preview-token-12345
```

### **Repository Variables**

Configure these variables in `Settings > Secrets and variables > Actions > Variables`:

```bash
# Production Configuration
PRODUCTION_STORAGE_TYPE=TURSO
PRODUCTION_ENABLE_LOGS=true
PRODUCTION_ENABLE_AUTH=true

# Staging Configuration
STAGING_STORAGE_TYPE=KV
STAGING_ENABLE_LOGS=true
STAGING_ENABLE_AUTH=true
```

## 🏗️ Deno Deploy Setup

### 1. Create Deno Deploy Projects

Create these projects in your [Deno Deploy dashboard](https://dash.deno.com):

- `done-production` - Production environment
- `done-staging` - Staging environment  
- `done-preview-pr-{number}` - Created automatically for PR previews

### 2. Get Deno Deploy Token

1. Go to [Deno Deploy Settings](https://dash.deno.com/account/settings)
2. Create a new **Access Token**
3. Copy the token and add it as `DENO_DEPLOY_TOKEN` secret in GitHub

### 3. Configure Project Settings

For each project, configure:

**Production Project (`done-production`):**
- **Custom Domain**: `done.yourdomain.com` (optional)
- **Environment Variables**: Set via GitHub workflow (automatic)

**Staging Project (`done-staging`):**  
- **Custom Domain**: `done-staging.yourdomain.com` (optional)
- **Environment Variables**: Set via GitHub workflow (automatic)

## 🗄️ Database Setup

### Turso Database Configuration

1. **Create Turso Databases:**
   ```bash
   # Production database
   turso db create done-production
   
   # Staging database
   turso db create done-staging
   ```

2. **Get Connection Details:**
   ```bash
   # Get database URLs
   turso db show done-production
   turso db show done-staging
   
   # Create auth tokens
   turso db tokens create done-production
   turso db tokens create done-staging
   ```

3. **Run Migrations:**
   ```bash
   # Production
   turso db shell done-production < migrations/000_create_migrations_table.sql
   turso db shell done-production < migrations/001_create_messages_table.sql
   turso db shell done-production < migrations/002_create_logs_table.sql
   
   # Staging
   turso db shell done-staging < migrations/000_create_migrations_table.sql
   turso db shell done-staging < migrations/001_create_messages_table.sql  
   turso db shell done-staging < migrations/002_create_logs_table.sql
   ```

## ⚙️ GitHub Repository Settings

### Branch Protection Rules

Set up branch protection for `main` branch (`Settings > Branches`):

```yaml
Protection Rules for 'main':
✅ Require a pull request before merging
  ✅ Require approvals: 1
  ✅ Dismiss stale PR approvals when new commits are pushed
  ✅ Require review from code owners

✅ Require status checks to pass before merging  
  ✅ Require branches to be up to date before merging
  Required Status Checks:
    - Test & Lint
    - Security Scan  
    - API Validation

✅ Require conversation resolution before merging
✅ Include administrators (recommended)
```

### Environment Protection Rules

Configure environment protection (`Settings > Environments`):

**Production Environment:**
- ✅ Required reviewers: [Your GitHub username]
- ✅ Wait timer: 5 minutes
- ✅ Deployment branches: `main` only

**Staging Environment:**
- ✅ Deployment branches: All branches

## 🔄 Workflow Overview

### **CI Workflow** (`ci.yml`)
**Triggers:** PRs to main, pushes to main
**Steps:**
1. Format & lint checks
2. Type checking  
3. Run tests (KV + Turso)
4. Security scanning
5. API validation
6. PR status comments

### **Deployment Workflow** (`deploy.yml`)  
**Triggers:** CI success, manual dispatch
**Steps:**
1. Run comprehensive tests
2. Deploy to staging/production
3. Health checks
4. Smoke tests (production)
5. Rollback on failure

### **Preview Workflow** (`preview.yml`)
**Triggers:** PR opened/updated  
**Steps:**
1. Deploy PR to preview environment
2. Health check
3. Comment PR with preview URL
4. Cleanup on PR close

## 🧪 Testing the Setup

### 1. Test CI Pipeline
Create a test PR:
```bash
git checkout -b test/ci-setup
echo "# Test CI" >> TEST.md
git add TEST.md
git commit -m "test: verify CI pipeline"
git push origin test/ci-setup
```

### 2. Test Deployment
Merge to main or trigger manual deployment:
```bash
# Via GitHub UI: Actions > Deploy to Deno Deploy > Run workflow
```

### 3. Verify Deployments
Check your deployed applications:
- **Production**: `https://done-production.deno.dev/v1/system/ping`
- **Staging**: `https://done-staging.deno.dev/v1/system/ping`

## 🚨 Troubleshooting

### Common Issues

**❌ "DENO_DEPLOY_TOKEN not found"**
- Verify token is set in repository secrets
- Ensure token has correct permissions

**❌ "Database connection failed"**  
- Check Turso URL and auth token
- Verify database exists and migrations ran

**❌ "Tests failing in CI"**
- Run tests locally: `deno task test`
- Check environment variables
- Verify all dependencies are available

**❌ "Deployment health check failed"**
- Check Deno Deploy logs
- Verify environment variables are set
- Test endpoints manually

### Getting Help

1. **Check workflow logs** in GitHub Actions tab
2. **Review Deno Deploy logs** in dashboard  
3. **Test locally** with same environment variables
4. **Check documentation** for latest updates

## 🔧 Maintenance

### Regular Tasks

1. **Monitor deployments** via Deno Deploy dashboard
2. **Review dependency updates** from Dependabot
3. **Rotate secrets** every 90 days
4. **Update environment variables** as needed
5. **Review and update workflows** quarterly

### Security Best Practices

- ✅ Use environment-specific tokens
- ✅ Rotate secrets regularly  
- ✅ Limit token permissions
- ✅ Review access logs
- ✅ Monitor for unauthorized deployments

---

## 📚 Additional Resources

- [Deno Deploy Documentation](https://deno.com/deploy/docs)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Turso Documentation](https://docs.turso.tech)
- [Repository Settings Guide](https://docs.github.com/en/repositories)

✅ **Your CI/CD pipeline is now ready for production!** 🎉