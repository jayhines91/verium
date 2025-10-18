#!/bin/bash

# Verium Testnet Setup Script
# This script sets up a complete Verium testnet with multiple nodes and explorer

set -e

# Configuration
DOCKER_APPDATA="/docker/appdata"
TESTNET_DIR="${DOCKER_APPDATA}/verium-testnet"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root or with sudo
if [ "$EUID" -eq 0 ]; then
    print_warning "Running as root. This is not recommended for Docker."
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed. Please install Docker Compose and try again."
    exit 1
fi

# Create directory structure
print_status "Creating directory structure..."
sudo mkdir -p "${TESTNET_DIR}/node1"
sudo mkdir -p "${TESTNET_DIR}/node2"
sudo mkdir -p "${TESTNET_DIR}/node3"
sudo mkdir -p "${TESTNET_DIR}/miner"
sudo mkdir -p "${TESTNET_DIR}/explorer-cache"

# Set proper permissions
print_status "Setting directory permissions..."
sudo chown -R 1001:1001 "${TESTNET_DIR}"

print_success "Directory structure created at ${TESTNET_DIR}"

# Check if Verium Docker image exists
print_status "Checking for Verium Docker image..."
if ! docker images | grep -q "verium.*latest"; then
    print_warning "Verium Docker image not found. You'll need to build or pull a Verium Docker image."
    print_status "You can create a simple Verium Dockerfile or use an existing image."
    print_status "For now, we'll proceed with the assumption that you have a 'verium:latest' image."
    
    read -p "Do you want to continue? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "Setup cancelled. Please build or pull a Verium Docker image first."
        exit 1
    fi
fi

# Build the explorer image
print_status "Building Verium RPC Explorer image..."
if docker build -f Dockerfile.verium -t verium-rpc-explorer:testnet .; then
    print_success "Explorer image built successfully!"
else
    print_error "Failed to build explorer image"
    exit 1
fi

# Start the testnet
print_status "Starting Verium testnet..."
if docker-compose -f docker-compose.verium-testnet.yml up -d; then
    print_success "Verium testnet started successfully!"
else
    print_error "Failed to start testnet"
    exit 1
fi

# Wait for services to be ready
print_status "Waiting for services to be ready..."
sleep 30

# Check service status
print_status "Checking service status..."
docker-compose -f docker-compose.verium-testnet.yml ps

# Show useful information
echo ""
print_success "Verium Testnet Setup Complete!"
echo ""
print_status "Services running:"
echo "  - Node 1 (Primary):     http://localhost:36988 (RPC)"
echo "  - Node 2:               http://localhost:36991 (RPC)"
echo "  - Node 3:               http://localhost:36993 (RPC)"
echo "  - Explorer:             http://localhost:3003"
echo "  - Miner:                Internal only"
echo ""
print_status "Useful commands:"
echo "  View logs:              docker-compose -f docker-compose.verium-testnet.yml logs -f"
echo "  Stop testnet:           docker-compose -f docker-compose.verium-testnet.yml down"
echo "  Restart services:       docker-compose -f docker-compose.verium-testnet.yml restart"
echo "  Check node status:      docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo"
echo "  Generate test blocks:   docker exec verium-testnet-miner verium-cli -conf=/root/.verium/verium.conf generate 10"
echo ""
print_status "Data stored at: ${TESTNET_DIR}"
echo ""
print_warning "Note: You may need to generate some initial blocks for the testnet to be fully functional."
print_status "Run: docker exec verium-testnet-miner verium-cli -conf=/root/.verium/verium.conf generate 10"
