#!/bin/bash

# Verium Testnet Management Script
# This script provides easy management commands for the Verium testnet

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

# Function to show usage
show_usage() {
    echo "Verium Testnet Management Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start       Start the testnet"
    echo "  stop        Stop the testnet"
    echo "  restart     Restart the testnet"
    echo "  status      Show service status"
    echo "  logs        Show logs (use -f for follow)"
    echo "  generate    Generate test blocks (default: 10)"
    echo "  info        Show blockchain info"
    echo "  peers       Show peer connections"
    echo "  mining      Show mining info"
    echo "  explorer    Open explorer in browser"
    echo "  shell       Open shell in node1 container"
    echo "  cleanup     Remove all containers and data"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 start"
    echo "  $0 logs -f"
    echo "  $0 generate 50"
    echo "  $0 shell"
}

# Function to start testnet
start_testnet() {
    print_status "Starting Verium testnet..."
    if docker-compose -f docker-compose.verium-testnet.yml up -d; then
        print_success "Testnet started successfully!"
        print_status "Explorer available at: http://localhost:3003"
    else
        print_error "Failed to start testnet"
        exit 1
    fi
}

# Function to stop testnet
stop_testnet() {
    print_status "Stopping Verium testnet..."
    if docker-compose -f docker-compose.verium-testnet.yml down; then
        print_success "Testnet stopped successfully!"
    else
        print_error "Failed to stop testnet"
        exit 1
    fi
}

# Function to restart testnet
restart_testnet() {
    print_status "Restarting Verium testnet..."
    if docker-compose -f docker-compose.verium-testnet.yml restart; then
        print_success "Testnet restarted successfully!"
    else
        print_error "Failed to restart testnet"
        exit 1
    fi
}

# Function to show status
show_status() {
    print_status "Verium Testnet Status:"
    docker-compose -f docker-compose.verium-testnet.yml ps
}

# Function to show logs
show_logs() {
    if [ "$1" = "-f" ]; then
        print_status "Showing logs (following)..."
        docker-compose -f docker-compose.verium-testnet.yml logs -f
    else
        print_status "Showing recent logs..."
        docker-compose -f docker-compose.verium-testnet.yml logs --tail=50
    fi
}

# Function to generate blocks
generate_blocks() {
    local count=${1:-10}
    print_status "Generating $count test blocks..."
    
    if docker exec verium-testnet-miner verium-cli -conf=/root/.verium/verium.conf generate $count; then
        print_success "Generated $count blocks successfully!"
    else
        print_error "Failed to generate blocks"
        exit 1
    fi
}

# Function to show blockchain info
show_info() {
    print_status "Blockchain Information:"
    echo ""
    print_status "Node 1 (Primary):"
    docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo
    echo ""
    print_status "Node 2:"
    docker exec verium-testnet-node2 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo
    echo ""
    print_status "Node 3:"
    docker exec verium-testnet-node3 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo
}

# Function to show peers
show_peers() {
    print_status "Peer Connections:"
    echo ""
    print_status "Node 1 Peers:"
    docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getpeerinfo
    echo ""
    print_status "Node 2 Peers:"
    docker exec verium-testnet-node2 verium-cli -conf=/root/.verium/verium.conf getpeerinfo
}

# Function to show mining info
show_mining() {
    print_status "Mining Information:"
    docker exec verium-testnet-miner verium-cli -conf=/root/.verium/verium.conf getmininginfo
}

# Function to open explorer
open_explorer() {
    print_status "Opening explorer in browser..."
    if command -v xdg-open > /dev/null; then
        xdg-open http://localhost:3003
    elif command -v open > /dev/null; then
        open http://localhost:3003
    else
        print_status "Please open http://localhost:3003 in your browser"
    fi
}

# Function to open shell
open_shell() {
    print_status "Opening shell in node1 container..."
    docker exec -it verium-testnet-node1 /bin/bash
}

# Function to cleanup
cleanup() {
    print_warning "This will remove all containers and data. Are you sure? (y/N)"
    read -p "" -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Stopping and removing containers..."
        docker-compose -f docker-compose.verium-testnet.yml down -v
        
        print_status "Removing data directories..."
        sudo rm -rf /docker/appdata/verium-testnet
        
        print_status "Removing Docker images..."
        docker rmi verium-rpc-explorer:testnet 2>/dev/null || true
        
        print_success "Cleanup completed!"
    else
        print_status "Cleanup cancelled."
    fi
}

# Main script logic
case "$1" in
    start)
        start_testnet
        ;;
    stop)
        stop_testnet
        ;;
    restart)
        restart_testnet
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$2"
        ;;
    generate)
        generate_blocks "$2"
        ;;
    info)
        show_info
        ;;
    peers)
        show_peers
        ;;
    mining)
        show_mining
        ;;
    explorer)
        open_explorer
        ;;
    shell)
        open_shell
        ;;
    cleanup)
        cleanup
        ;;
    help|--help|-h)
        show_usage
        ;;
    "")
        show_usage
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac
