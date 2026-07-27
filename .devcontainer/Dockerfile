# The image tag is only a starting point; the effective Node.js version is set
# from the repository's .nvmrc below, which is the single source of truth
# (shared with CI via actions/setup-node and with the VS Code Extension Host).
FROM mcr.microsoft.com/devcontainers/typescript-node:24

# Install and activate the exact Node.js version pinned in .nvmrc via the nvm
# that ships with the base image, so the devcontainer matches CI and the
# VS Code runtime. Run as the non-root "node" user so it lands in the shared
# nvm dir and the default alias / current symlink resolve to it at runtime.
COPY .nvmrc /tmp/.nvmrc
RUN su node -c '. "$NVM_DIR/nvm.sh" \
    && nvm install "$(cat /tmp/.nvmrc)" \
    && nvm alias default "$(cat /tmp/.nvmrc)" \
    && nvm use default' \
    && rm -f /tmp/.nvmrc

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends wget \
                                                  gpg \
                                                  xvfb \
                                                  xauth \
    && wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg \
    && install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg \
    && sh -c 'echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" > /etc/apt/sources.list.d/vscode.list' \
    && rm -f packages.microsoft.gpg \
    && apt-get update \
    && apt-get install -y code
