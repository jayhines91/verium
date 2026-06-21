# Connecting External Wallets to Verium Testnet

This guide explains how to connect external Verium wallets to your testnet.

## Prerequisites

- Verium testnet running (see README-Testnet.md)
- External wallet (Verium 1.3.1 or compatible)
- Network access to the testnet server

## Network Configuration

### Current Setup
The testnet exposes these RPC ports:
- **Node 1 (Primary)**: Port 36988
- **Node 2**: Port 36991  
- **Node 3**: Port 36993

### For External Access

You need to ensure the RPC ports are accessible from external networks.

## Connecting Your Mac Pro Wallet

### Method 1: Direct Connection (Same Network)

If your Mac Pro is on the same network as the testnet server:

1. **Find the testnet server IP**:
   ```bash
   # On the testnet server
   ip addr show | grep inet
   ```

2. **Configure your Verium wallet** on Mac Pro:
   
   Create a `verium-testnet.conf` file in your Verium data directory:
   ```ini
   # Verium Testnet Configuration for Mac Pro
   testnet=1
   
   # Connect to your testnet server
   server=1
   rpcuser=testnet_user
   rpcpassword=testnet_password
   rpcallowip=127.0.0.1
   
   # Connect to the testnet
   connect=<TESTNET_SERVER_IP>:36989
   addnode=<TESTNET_SERVER_IP>:36989
   
   # Optional: Enable RPC for wallet operations
   rpcport=36999
   ```

3. **Start Verium wallet**:
   ```bash
   veriumd -conf=verium-testnet.conf
   ```

### Method 2: RPC-Only Connection

If you only need to send transactions via RPC:

1. **Configure wallet for RPC connection**:
   ```ini
   # Verium Testnet RPC Configuration
   testnet=1
   server=1
   rpcuser=testnet_user
   rpcpassword=testnet_password
   rpcallowip=127.0.0.1
   rpcport=36999
   ```

2. **Connect to testnet RPC**:
   ```bash
   # Test connection
   verium-cli -testnet -rpcuser=testnet_user -rpcpassword=testnet_password -rpcconnect=<TESTNET_SERVER_IP> -rpcport=36988 getblockchaininfo
   ```

## External User Access

### For Other Users to Connect

Other users can connect to your testnet by:

1. **Getting connection details** from you:
   - Testnet server IP address
   - RPC credentials (testnet_user/testnet_password)
   - Port numbers (36988, 36991, 36993)

2. **Configuring their Verium client**:
   ```ini
   # External user configuration
   testnet=1
   
   # Connect to your testnet
   connect=<YOUR_SERVER_IP>:36989
   addnode=<YOUR_SERVER_IP>:36989
   
   # RPC access (if needed)
   server=1
   rpcuser=testnet_user
   rpcpassword=testnet_password
   rpcallowip=127.0.0.1
   ```

### Network Requirements

For external access, ensure:

1. **Firewall Configuration**:
   ```bash
   # Allow testnet ports
   sudo ufw allow 36988/tcp  # RPC port
   sudo ufw allow 36989/tcp  # P2P port
   sudo ufw allow 36991/tcp  # Node 2 RPC
   sudo ufw allow 36993/tcp  # Node 3 RPC
   sudo ufw allow 3003/tcp   # Explorer
   ```

2. **Router Configuration** (if behind NAT):
   - Port forward 36988, 36989, 36991, 36993 to your server
   - Or use a VPN for secure access

## Security Considerations

### Current Setup (Development Only)
- RPC credentials are hardcoded
- No SSL/TLS encryption
- Open to all IPs (0.0.0.0/0)

### For Production Use

1. **Change RPC credentials**:
   ```ini
   rpcuser=your_secure_username
   rpcpassword=your_secure_password
   ```

2. **Restrict RPC access**:
   ```ini
   # Only allow specific IPs
   rpcallowip=192.168.1.0/24
   rpcallowip=10.0.0.0/8
   ```

3. **Use SSL/TLS** (if supported by Verium):
   ```ini
   rpcssl=1
   rpcsslcertificatechainfile=/path/to/cert.pem
   rpcsslprivatekeyfile=/path/to/key.pem
   ```

## Testing Connections

### Test RPC Connection
```bash
# From external machine
verium-cli -testnet -rpcuser=testnet_user -rpcpassword=testnet_password -rpcconnect=<SERVER_IP> -rpcport=36988 getblockchaininfo
```

### Test P2P Connection
```bash
# Check if node accepts connections
telnet <SERVER_IP> 36989
```

### Test Explorer Access
Open in browser: `http://<SERVER_IP>:3003`

## Troubleshooting

### Wallet Won't Connect

1. **Check network connectivity**:
   ```bash
   ping <SERVER_IP>
   telnet <SERVER_IP> 36989
   ```

2. **Check firewall rules**:
   ```bash
   sudo ufw status
   ```

3. **Check Verium logs**:
   ```bash
   ./manage-verium-testnet.sh logs
   ```

### RPC Connection Failed

1. **Verify RPC is enabled**:
   ```bash
   docker exec verium-testnet-node1 verium-cli -conf=/root/.verium/verium.conf getnetworkinfo
   ```

2. **Check RPC credentials**:
   ```bash
   # Test with correct credentials
   verium-cli -testnet -rpcuser=testnet_user -rpcpassword=testnet_password -rpcconnect=localhost -rpcport=36988 getblockchaininfo
   ```

### Blockchain Sync Issues

1. **Check if testnet has blocks**:
   ```bash
   ./manage-verium-testnet.sh info
   ```

2. **Generate more blocks if needed**:
   ```bash
   ./manage-verium-testnet.sh generate 50
   ```

## Example Configurations

### Mac Pro Wallet (Full Node)
```ini
# ~/.verium/verium-testnet.conf
testnet=1
server=1
rpcuser=testnet_user
rpcpassword=testnet_password
rpcallowip=127.0.0.1
rpcport=36999

# Connect to testnet
connect=<TESTNET_SERVER_IP>:36989
addnode=<TESTNET_SERVER_IP>:36989

# Data directory
datadir=~/.verium-testnet
```

### External User (Light Client)
```ini
# ~/.verium/verium-testnet.conf
testnet=1
server=1
rpcuser=testnet_user
rpcpassword=testnet_password
rpcallowip=127.0.0.1

# Connect to testnet
connect=<TESTNET_SERVER_IP>:36989
addnode=<TESTNET_SERVER_IP>:36989

# Don't store full blockchain
prune=1000
```

## Network Topology

```
Internet
    |
    | (Port 36989, 36988, 36991, 36993)
    |
[Your Testnet Server]
    |
    | (Docker Network 172.20.0.0/16)
    |
[Verium Nodes + Explorer]
    |
    | (Port 3003)
    |
[Web Explorer]
```

## Support

For connection issues:
1. Check the testnet logs: `./manage-verium-testnet.sh logs`
2. Verify network connectivity
3. Check firewall and router settings
4. Ensure Verium versions are compatible
