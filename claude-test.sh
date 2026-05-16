#!/bin/bash
# local claude w/plugins loaded
claude --dangerously-skip-permissions \
    --dangerously-load-development-channels plugin:whatsup@shrivu-plugins \
    --plugin-dir ./plugins/brw \
    --plugin-dir ./plugins/freetaxusa \
    --plugin-dir ./plugins/whatsup \
    --plugin-dir ./plugins/diy-mcp-connector \
    --plugin-dir ./plugins/cc-essentials \
    --debug