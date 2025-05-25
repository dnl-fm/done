#!/usr/bin/env -S deno run -A --unstable-kv --unstable-cron

/**
 * Deployment entry point for Deno Deploy
 * This file ensures the application runs with the required unstable flags.
 */

import './src/main.ts';