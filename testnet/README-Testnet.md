# Verium Testnet Docker Setup

This setup provides a complete Verium testnet environment with multiple nodes, mining capabilities, and a web explorer.

## Architecture

The testnet consists of:
- **3 Verium Nodes**: Primary node + 2 additional nodes for network redundancy
- **1 Mining Node**: Dedicated node for generating test blocks
- **1 Explorer**: Web interface for browsing the testnet blockchain
- **Persistent Storage**: All data stored in `/docker/appdata/verium-testnet/`

## Quick Start

### 1. Initial Setup

```bash
# Run the setup script
./setup-verium-testnet.sh
```

This will:
- Create directory structure in `/docker/appdata/verium-testnet/`
- Build the explorer Docker image
- Start all services
- Set up proper permissions

### 2. Generate Initial Blocks

```bash
# Generate 10 test blocks
./manage-verium-testnet.sh generate 10
```

### 3. Access the Explorer

Open your browser and navigate to: http://localhost:3003

## Management Commands

Use the management script for easy operations:

```bash
# Start the testnet
./manage-verium-testnet.sh start

# Stop the testnet
./manage-verium-testnet.sh stop

# View logs
./manage-verium-testnet.sh logs
./manage-verium-testnet.sh logs -f  # Follow logs

# Check status
./manage-verium-testnet.sh status

# Generate test blocks
./manage-verium-testnet.sh generate 50

# Show blockchain info
./manage-verium-testnet.sh info

# Show peer connections
./manage-verium-testnet.sh peers

# Open explorer in browser
./manage-verium-testnet.sh explorer

# Open shell in node1
./manage-verium-testnet.sh shell

# Cleanup everything
./manage-verium-testnet.sh cleanup
```

## Service Details

### Verium Nodes

| Service | Container | RPC Port | P2P Port | IP Address |
|---------|-----------|----------|----------|------------|
| Node 1 (Primary) | verium-testnet-node1 | 36988 | 36989 | 172.20.0.10 |
| Node 2 | verium-testnet-node2 | 36991 | 36990 | 172.20.0.11 |
| Node 3 | verium-testnet-node3 | 36993 | 36992 | 172.20.0.12 |
| Miner | verium-testnet-miner | - | - | 172.20.0.13 |

### Explorer

| Service | Container | Web Port | IP Address |
|---------|-----------|----------|------------|
| Explorer | verium-testnet-explorer | 3003 | 172.20.0.20 |

## Configuration Files

Each node has its own configuration file in the `configs/` directory:

- `verium-testnet-node1.conf` - Primary node configuration
- `verium-testnet-node2.conf` - Secondary node configuration  
- `verium-testnet-node3.conf` - Third node configuration
- `verium-testnet-miner.conf` - Mining node configuration

## Data Storage

All persistent data is stored in `/docker/appdata/verium-testnet/`:

```
/docker/appdata/verium-testnet/
├── node1/           # Node 1 blockchain data
├── node2/           # Node 2 blockchain data
├── node3/           # Node 3 blockchain data
├── miner/           # Miner node blockchain data
└── explorer-cache/  # Explorer cache data
```

## Network Configuration

The testnet uses a custom Docker network (`172.20.0.0/16`) with:
- Internal communication between nodes
- External access to RPC ports and explorer
- Isolated from other Docker networks

## Prerequisites

### Required
- Docker and Docker Compose
- Verium Docker image (`verium:latest`)
- Write access to `/docker/appdata/`

### Verium Docker Image

You need a Verium Docker image. You can either:

1. **Build your own**:
   ```bash
   # Create a simple Dockerfile for Verium
   FROM ubuntu:20.04
   RUN apt-get update && apt-get install -y verium
   CMD ["veriumd"]
   ```

2. **Use an existing image** (if available)

3. **Modify the docker-compose file** to use a different image name

## Troubleshooting

### Services Won't Start

1. **Check Docker is running**:
   ```bash
   docker info
   ```

2. **Check port availability**:
   ```bash
   lsof -i :36988
   lsof -i :3003
   ```

3. **Check logs**:
   ```bash
   ./manage-verium-testnet.sh logs
   ```

### Nodes Not Connecting

1. **Check network connectivity**:
   ```bash
   docker network ls
   docker network inspect verium-testnet_verium-testnet
   ```

2. **Check node configurations**:
   ```bash
   docker exec verium-testnet-node1 cat /root/.verium/verium.conf
   ```

### Explorer Not Loading

1. **Check explorer logs**:
   ```bash
   docker logs verium-testnet-explorer
   ```

2. **Verify RPC connection**:
   ```bash
   docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getblockchaininfo
   ```

### Permission Issues

1. **Fix directory permissions**:
   ```bash
   sudo chown -R 1001:1001 /docker/appdata/verium-testnet/
   ```

2. **Check container user**:
   ```bash
   docker exec verium-testnet-node1 id
   ```

## Advanced Usage

### Custom Configuration

Edit the configuration files in `configs/` to customize:
- Network parameters
- Mining settings
- RPC access
- Performance settings

### Adding More Nodes

1. Copy a node configuration file
2. Update the IP address and ports
3. Add the new service to `docker-compose.verium-testnet.yml`
4. Update the `addnode` entries in other configurations

### External Access

To allow external access to the testnet:

1. **Update firewall rules** for ports 36988, 36991, 36993, 3003
2. **Modify RPC settings** in configuration files:
   ```ini
   rpcallowip=0.0.0.0/0
   ```
3. **Update docker-compose ports** if needed

### Monitoring

Monitor the testnet using:

```bash
# Check resource usage
docker stats

# Monitor logs
./manage-verium-testnet.sh logs -f

# Check blockchain status
./manage-verium-testnet.sh info
```

## Security Notes

- This setup is for **testing purposes only**
- RPC credentials are hardcoded (change for production)
- External access is enabled by default
- No SSL/TLS encryption
- Use proper security measures for production deployments

## Support

For issues:
1. Check the logs: `./manage-verium-testnet.sh logs`
2. Verify Docker and Docker Compose are working
3. Check the [main README](README.md) for general troubleshooting
4. Review the [GitHub repository](https://github.com/jayhines91/btc-rpc-explorer) for updates
