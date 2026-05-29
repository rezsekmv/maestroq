# Running `maestroq` as a service

`maestroq daemon start` backgrounds itself by default (logs to `~/.maestroq/daemon.log`). That's enough for ad-hoc use, but it does not survive a logout/reboot. To keep the daemon up across logins, install it as a service with the `--foreground` flag (so the service manager owns the process lifecycle instead of the daemon detaching out from under it).

## macOS — launchd

Save as `~/Library/LaunchAgents/dev.maestroq.daemon.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.maestroq.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/maestroq</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/maestroq.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/maestroq.err.log</string>
</dict>
</plist>
```

Then:

```bash
launchctl load ~/Library/LaunchAgents/dev.maestroq.daemon.plist
launchctl start dev.maestroq.daemon
```

Adjust the `maestroq` path if you installed via nvm or volta.

## Linux — systemd (user unit)

Save as `~/.config/systemd/user/maestroq.service`:

```ini
[Unit]
Description=maestroq daemon
After=default.target

[Service]
ExecStart=%h/.npm-global/bin/maestroq daemon start --foreground
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now maestroq.service
```

A `maestroq daemon install` command that writes these for you is a v0.2 candidate.
