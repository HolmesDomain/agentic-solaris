#!/bin/bash

# Staggered PM2 startup script
# Reads instance count from ecosystem.config.cjs and starts them with delays

DELAY=10  # seconds between each instance

# Extract instance counts from ecosystem.config.cjs
STYLE_INSTANCES=$(node -e "const config = require('./ecosystem.config.cjs'); console.log(config.apps.find(a => a.name === 'solaris-style').instances)")
PRIME_INSTANCES=$(node -e "const config = require('./ecosystem.config.cjs'); console.log(config.apps.find(a => a.name === 'solaris-prime').instances)")

echo "Starting $STYLE_INSTANCES solaris-style instances with ${DELAY}-second stagger..."
pm2 start ecosystem.config.cjs --only solaris-style
pm2 scale solaris-style 0  # Start with 0 instances

for i in $(seq 1 $STYLE_INSTANCES); do
  pm2 scale solaris-style $i
  if [ $i -lt $STYLE_INSTANCES ]; then
    echo "Waiting $DELAY seconds before starting next instance..."
    sleep $DELAY
  fi
done

echo ""
echo "Starting $PRIME_INSTANCES solaris-prime instances with ${DELAY}-second stagger..."
pm2 start ecosystem.config.cjs --only solaris-prime
pm2 scale solaris-prime 0

for i in $(seq 1 $PRIME_INSTANCES); do
  pm2 scale solaris-prime $i
  if [ $i -lt $PRIME_INSTANCES ]; then
    echo "Waiting $DELAY seconds before starting next instance..."
    sleep $DELAY
  fi
done

echo ""
echo "All instances started!"
pm2 status
