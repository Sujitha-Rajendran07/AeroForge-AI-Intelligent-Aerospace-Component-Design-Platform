#!/bin/bash
# AeroForge AI — Quick Install Script

echo ""
echo "  ✈  AeroForge AI v3.0 — Install Script"
echo "  ========================================"
echo ""

# Check node version
NODE_VER=$(node --version 2>/dev/null)
if [ -z "$NODE_VER" ]; then
  echo "  ✗  Node.js not found. Please install Node.js 18+ from https://nodejs.org"
  exit 1
fi
echo "  ✓  Node.js $NODE_VER detected"

# Install dependencies
echo "  →  Installing backend dependencies..."
cd "$(dirname "$0")/backend"
npm install

if [ $? -ne 0 ]; then
  echo "  ✗  npm install failed"
  exit 1
fi

echo "  ✓  Dependencies installed"
echo ""
echo "  → Starting AeroForge server..."
echo ""
node server.js
