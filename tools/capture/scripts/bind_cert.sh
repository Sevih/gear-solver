#!/system/bin/sh
SYS=/system/etc/security/cacerts
TMP=/data/local/tmp/cacerts
rm -rf "$TMP"
mkdir -p "$TMP"
cp "$SYS"/* "$TMP"/ 2>/dev/null
cp /sdcard/c8750f0d.0 "$TMP"/c8750f0d.0
chmod 644 "$TMP"/*
chown root:root "$TMP"/*
chcon u:object_r:system_file:s0 "$TMP"/* 2>/dev/null
mount --bind "$TMP" "$SYS"
echo "--- bind done, cert present in system dir? ---"
ls -lZ "$SYS"/c8750f0d.0
echo "--- mount line ---"
mount | grep cacerts
echo "--- count ---"
ls "$SYS" | wc -l
