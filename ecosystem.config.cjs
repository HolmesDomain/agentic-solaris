const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

// Load environment files
const envPrime = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.prime')));
const envStyle = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env.style')));

module.exports = {
  apps: [
    {
      name: "solaris-style",
      script: "dist/index.js",
      interpreter: "bun",
      cwd: "/Users/andrewholmes/Downloads/agentic-solaris",
      env: envStyle,
      instances: 11,
      watch: false,
      ignore_watch: ["output", "node_modules", "dist"],
      autorestart: true,
    },
    // {
    //   name: "solaris-prime",
    //   script: "dist/index.js",
    //   interpreter: "bun",
    //   cwd: "/Users/andrewholmes/Downloads/agentic-solaris",
    //   env: envPrime,
    //   instances: 6,
    //   watch: false,
    //   ignore_watch: ["output", "node_modules", "dist"],
    //   autorestart: true,
    // }
  ]
};
