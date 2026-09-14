# Security

MuxMap provides privileged local terminal access. File access is unrestricted by default, subject to the server process's OS permissions. Set `MUXMAP_ALLOWED_ROOTS` to restrict file previews and terminal starting directories; this does not sandbox commands run inside a terminal. Keep MuxMap bound to localhost and do not expose port 4782 to an untrusted network.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/syntaxskills/muxmap/security/advisories/new). Do not open a public issue for an unpatched security problem.
