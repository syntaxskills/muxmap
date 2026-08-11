# Windows network access

Keep MuxMap local unless another device needs it. Run commands in Command Prompt before starting MuxMap.

## LAN

```bat
set MUXMAP_ACCESS=lan
set MUXMAP_TOKEN=choose-a-long-password
npm run doctor
```

Doctor prints the usable LAN URLs. If the firewall check fails, run the generated `.muxmap\muxmap-firewall-lan-4782.ps1` once from Administrator PowerShell, then rerun Doctor. The rule allows only the machine's current private subnet and MuxMap port. Connect with Basic Auth username `muxmap` and the token as password.

## Tailscale

Install and sign in to Tailscale, then run:

```bat
set MUXMAP_ACCESS=tailscale
set MUXMAP_TOKEN=choose-a-long-password
npm run doctor
```

MuxMap binds only the address returned by `tailscale ip -4`. If requested, run the generated firewall script as Administrator; it permits only `100.64.0.0/10` on the configured port. For tailnet HTTPS without direct binding, keep `MUXMAP_ACCESS=local` and run `tailscale serve --bg 4782`.

Agent hooks inherit `MUXMAP_TOKEN` and send Basic Auth automatically. If the hook uses direct Tailscale binding, set `MUXMAP_URL` to the URL printed at startup.

## Password-free access

Password authentication can be disabled explicitly for a trusted network:

```bat
set MUXMAP_ACCESS=lan
set MUXMAP_AUTH=none
npm start
```

This gives every client allowed by Windows Firewall terminal control. Keep the generated subnet-only or Tailscale-only firewall rule in place. Remove `MUXMAP_AUTH` to restore the password requirement.
