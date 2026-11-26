#!/bin/sh
set -eu

fail() {
    printf 'OpenBoard installer: %s\n' "$*" >&2
    exit 1
}

download() {
    curl -q --proto '=https' --proto-redir '=https' -fsSL --retry 3 "$@"
}

verify_checksum() {
    expected=$(awk -v asset="$asset" '
        $2 == asset || $2 == "*" asset {
            if (length($1) != 64 || $1 ~ /[^0-9a-fA-F]/ || NF != 2) exit 1
            count++
            hash = tolower($1)
        }
        END { if (count != 1) exit 1; print hash }
    ' "$staging/SHA256SUMS") || fail "missing, invalid or duplicate SHA256 checksum for $asset"

    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum < "$staging/ob") || fail "could not hash $asset"
    elif command -v shasum >/dev/null 2>&1; then
        actual=$(shasum -a 256 < "$staging/ob") || fail "could not hash $asset"
    else
        fail 'install sha256sum or shasum to verify the download'
    fi
    [ "${actual%% *}" = "$expected" ] || fail "SHA256 checksum mismatch for $asset"
}

main() {
    version=${OPENBOARD_VERSION-}
    dry_run=false
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --version)
                [ "$#" -ge 2 ] && [ -n "$2" ] || fail '--version requires vX.Y.Z'
                version=$2
                shift
                ;;
            --dry-run) dry_run=true ;;
            *) fail "unknown option: $1" ;;
        esac
        shift
    done

    os=$(uname -s) || fail 'could not detect the operating system'
    arch=$(uname -m) || fail 'could not detect the CPU architecture'
    case "$os" in
        Darwin) os=darwin ;;
        Linux) os=linux ;;
        *) fail "unsupported operating system: $os" ;;
    esac
    case "$arch" in
        arm64|aarch64) arch=arm64 ;;
        x86_64|x64) arch=x64 ;;
        *) fail "unsupported CPU architecture: $arch" ;;
    esac

    repo=https://github.com/The-Vibe-Company/openboard
    asset=ob-bun-$os-$arch
    if [ -z "$version" ]; then
        release=$(download -o /dev/null -w '%{url_effective}' "$repo/releases/latest") ||
            fail 'could not resolve the latest GitHub release'
        case "$release" in
            "$repo/releases/tag/"*) version=${release##*/} ;;
            *) fail 'GitHub did not redirect to a release tag' ;;
        esac
    fi
    case "$version" in
        *[!v0-9.]*|'') fail "expected a version tag like v1.2.3, got: $version" ;;
    esac
    printf '%s\n' "$version" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' ||
        fail "expected a version tag like v1.2.3, got: $version"

    base=$repo/releases/download/$version
    if "$dry_run"; then
        printf '%s\n' "$base/$asset" "$base/SHA256SUMS"
        return
    fi

    install_dir=${OPENBOARD_INSTALL_DIR:-${HOME:?HOME must be set}/.local/bin}
    case "$install_dir" in
        /*) ;;
        *) install_dir=$(pwd -P)/$install_dir ;;
    esac
    mkdir -p "$install_dir" || fail "could not create $install_dir"
    [ ! -d "$install_dir/ob" ] || fail "$install_dir/ob is a directory"
    if [ -d "$install_dir/openboard" ] && [ ! -L "$install_dir/openboard" ]; then
        fail "$install_dir/openboard is a directory"
    fi

    staging=$(mktemp -d "$install_dir/.openboard-install.XXXXXXXX") || fail 'could not stage the installation'
    trap 'rm -rf "$staging"' 0
    trap 'exit 1' HUP INT TERM
    download -o "$staging/ob" "$base/$asset" || fail "could not download $asset"
    download -o "$staging/SHA256SUMS" "$base/SHA256SUMS" || fail 'could not download SHA256SUMS'
    verify_checksum
    chmod 755 "$staging/ob" || fail 'could not make ob executable'
    mv -f "$staging/ob" "$install_dir/ob" || fail "could not install $install_dir/ob"
    ln -sfn ob "$install_dir/openboard" || fail "could not link $install_dir/openboard"

    printf 'Installed OpenBoard %s at %s/ob (also available as openboard).\n' "$version" "$install_dir"
    case ":${PATH-}:" in
        *":$install_dir:"*) ;;
        *)
            quoted_dir=$(printf '%s\n' "$install_dir" | sed "s/'/'\\\\''/g")
            printf "Add OpenBoard to PATH: export PATH='%s':\"\$PATH\"\n" "$quoted_dir"
            ;;
    esac
    printf '%s\n' 'Next: run ob serve locally or ob login https://openboard.thevibecompany.co'
}

main "$@"
