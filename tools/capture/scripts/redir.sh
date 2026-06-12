#!/system/bin/sh
# enable loopback routing for REDIRECT from OUTPUT
sysctl -w net.ipv4.conf.all.route_localnet=1 >/dev/null 2>&1
echo "route_localnet=$(cat /proc/sys/net/ipv4/conf/all/route_localnet)"
# clean previous rules (idempotent)
iptables -t nat -D OUTPUT -p tcp --dport 38001 -j REDIRECT --to-ports 9001 2>/dev/null
iptables -t nat -D OUTPUT -p tcp --dport 38002 -j REDIRECT --to-ports 9002 2>/dev/null
# add redirects
iptables -t nat -A OUTPUT -p tcp --dport 38001 -j REDIRECT --to-ports 9001
iptables -t nat -A OUTPUT -p tcp --dport 38002 -j REDIRECT --to-ports 9002
echo "--- nat OUTPUT rules ---"
iptables -t nat -L OUTPUT -n -v --line-numbers | grep -E 'REDIRECT|Chain'
