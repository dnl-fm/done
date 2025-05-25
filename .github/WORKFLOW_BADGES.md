# 📊 Workflow Status Badges

Add these badges to your README.md to show the status of your workflows:

## Copy-Paste Ready Badges

```markdown
[![CI](https://github.com/dnl-fm/done/actions/workflows/ci.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/ci.yml)
[![Deploy](https://github.com/dnl-fm/done/actions/workflows/deploy.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/deploy.yml)
[![Code Quality](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml)
```

## Individual Badges

### CI Pipeline
```markdown
[![CI](https://github.com/dnl-fm/done/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/dnl-fm/done/actions/workflows/ci.yml)
```

### Deployment Status  
```markdown
[![Deploy](https://github.com/dnl-fm/done/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/dnl-fm/done/actions/workflows/deploy.yml)
```

### Code Quality
```markdown
[![Code Quality](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml)
```

### Preview Deployments
```markdown
[![Preview](https://github.com/dnl-fm/done/actions/workflows/preview.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/preview.yml)
```

## Custom Status Section

```markdown
## 🚀 Project Status

| Service | Status | Environment | URL |
|---------|--------|-------------|-----|
| Production | [![Deploy](https://github.com/dnl-fm/done/actions/workflows/deploy.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/deploy.yml) | Production | [done.deno.dev](https://done.deno.dev) |
| Staging | [![Deploy](https://github.com/dnl-fm/done/actions/workflows/deploy.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/deploy.yml) | Staging | [done-staging.deno.dev](https://done-staging.deno.dev) |
| Tests | [![CI](https://github.com/dnl-fm/done/actions/workflows/ci.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/ci.yml) | - | - |
| Code Quality | [![Code Quality](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml) | - | - |
```

## Recommendation

Add this section to the top of your README.md after the title:

```markdown
# Done - Webhook Queue Service

[![CI](https://github.com/dnl-fm/done/actions/workflows/ci.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/ci.yml)
[![Deploy](https://github.com/dnl-fm/done/actions/workflows/deploy.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/deploy.yml)
[![Code Quality](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml/badge.svg)](https://github.com/dnl-fm/done/actions/workflows/code-quality.yml)

> A reliable webhook delivery service with dual storage support (Deno KV + Turso)
```

**Note:** Replace `dnl-fm/done` with your actual GitHub repository path if different.