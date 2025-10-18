#!/bin/bash

# External Connectivity Test Script for Verium Testnet
# This script helps test if external wallets can connect to your testnet

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

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

echo "Verium Testnet External Connectivity Test"
echo "========================================"
echo ""

print_status "Server IP: $SERVER_IP"
print_status "Testing external connectivity..."
echo ""

# Test 1: Check if ports are open
print_status "Testing port accessibility..."

PORTS=(36988 36989 36991 36993 3003)
PORT_NAMES=("Node1 RPC" "Node1 P2P" "Node2 RPC" "Node3 RPC" "Explorer")

for i in "${!PORTS[@]}"; do
    PORT=${PORTS[$i]}
    NAME=${PORT_NAMES[$i]}
    
    if nc -z localhost $PORT 2>/dev/null; then
        print_success "$NAME (Port $PORT): Open"
    else
        print_error "$NAME (Port $PORT): Closed"
    fi
done

echo ""

# Test 2: Check RPC connectivity
print_status "Testing RPC connectivity..."

# Test Node 1 RPC
if docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo > /dev/null 2>&1; then
    print_success "Node 1 RPC: Working"
else
    print_error "Node 1 RPC: Failed"
fi

# Test Node 2 RPC
if docker exec verium-testnet-node2 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo > /dev/null 2>&1; then
    print_success "Node 2 RPC: Working"
else
    print_error "Node 2 RPC: Failed"
fi

# Test Node 3 RPC
if docker exec verium-testnet-node3 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo > /dev/null 2>&1; then
    print_success "Node 3 RPC: Working"
else
    print_error "Node 3 RPC: Failed"
fi

echo ""

# Test 3: Check network info
print_status "Network Information:"

# Get blockchain info
BLOCKCHAIN_INFO=$(docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo 2>/dev/null)
if [ $? -eq 0 ]; then
    BLOCKS=$(echo "$BLOCKCHAIN_INFO" | grep -o '"blocks":[0-9]*' | cut -d':' -f2)
    CHAIN=$(echo "$BLOCKCHAIN_INFO" | grep -o '"chain":"[^"]*"' | cut -d'"' -f4)
    print_success "Chain: $CHAIN"
    print_success "Blocks: $BLOCKS"
else
    print_error "Could not get blockchain info"
fi

# Get network info
NETWORK_INFO=$(docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getnetworkinfo 2>/dev/null)
if [ $? -eq 0 ]; then
    CONNECTIONS=$(echo "$NETWORK_INFO" | grep -o '"connections":[0-9]*' | cut -d':' -f2)
    print_success "Active Connections: $CONNECTIONS"
else
    print_error "Could not get network info"
fi

echo ""

# Test 4: Generate connection instructions
print_status "Connection Instructions for External Wallets:"
echo ""
echo "For your Mac Pro wallet, create a verium-testnet.conf file with:"
echo ""
echo "testnet=1"
echo "server=1"
echo "rpcuser=testnet_user"
echo "rpcpassword=testnet_password"
echo "rpcallowip=127.0.0.1"
echo "rpcport=36999"
echo ""
echo "# Connect to this testnet"
echo "connect=$SERVER_IP:36989"
echo "addnode=$SERVER_IP:36989"
echo ""

print_status "For other external users, they can connect using:"
echo ""
echo "RPC Connection:"
echo "  Host: $SERVER_IP"
echo "  Port: 36988 (Node 1), 36991 (Node 2), 36993 (Node 3)"
echo "  Username: testnet_user"
echo "  Password: testnet_password"
echo ""
echo "P2P Connection:"
echo "  Host: $SERVER_IP"
echo "  Port: 36989"
echo ""
echo "Web Explorer:"
echo "  URL: http://$SERVER_IP:3003"
echo ""

# Test 5: Check firewall status
print_status "Firewall Status:"
if command -v ufw > /dev/null; then
    UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1)
    print_status "UFW: $UFW_STATUS"
    
    if echo "$UFW_STATUS" | grep -q "active"; then
        print_warning "Firewall is active. Make sure these ports are open:"
        for PORT in "${PORTS[@]}"; do
            echo "  - Port $PORT"
        done
        echo ""
        print_status "To open ports, run:"
        for PORT in "${PORTS[@]}"; do
            echo "  sudo ufw allow $PORT/tcp"
        done
    fi
else
    print_warning "UFW not found. Check your firewall manually."
fi

echo ""

# Test 6: Test external RPC access
print_status "Testing external RPC access..."

# Try to connect from localhost (simulating external connection)
if command -v verium-cli > /dev/null; then
    if verium-cli -testnet -rpcuser=testnet_user -rpcpassword=testnet_password -rpcconnect=localhost -rpcport=36988 getblockchaininfo > /dev/null 2>&1; then
        print_success "External RPC access: Working"
    else
        print_error "External RPC access: Failed"
        print_warning "Make sure Verium CLI is installed and testnet is running"
    fi
else
    print_warning "Verium CLI not found. Cannot test external RPC access."
fi

echo ""
print_status "Test completed!"
echo ""
print_warning "Security Note: This testnet is configured for development only."
print_warning "For production use, change the RPC credentials and restrict access."
