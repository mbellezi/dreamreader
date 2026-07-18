# Build de bundles multiplataforma

O script `scripts/build-bundle.py` orquestra bundles Electron do DreamReader para Linux, Windows e macOS.

Ele valida dependencias antes do build, tenta instalar dependencias de sistema quando possivel e para a execucao se algo obrigatorio continuar ausente. Em Linux, ele tenta usar `sudo` para instalar pacotes; se a instalacao automatica falhar, imprime os comandos manuais e nao continua o empacotamento.

## Uso rapido

```bash
python3 scripts/build-bundle.py --target linux-appimage
python3 scripts/build-bundle.py --target windows-msi
python3 scripts/build-bundle.py --target mac-dmg
python3 scripts/build-bundle.py --target all
```

Opcoes uteis:

```bash
python3 scripts/build-bundle.py --target windows-msi --check-only
python3 scripts/build-bundle.py --target windows-msi --no-install-deps
python3 scripts/build-bundle.py --target windows-msi --keep-intermediate
python3 scripts/build-bundle.py --target linux-appimage --linux-runner docker
python3 scripts/build-bundle.py --target linux-appimage --linux-runner wsl
```

Por padrao, o script executa:

1. verificacao/instalacao de dependencias de sistema;
2. `npm ci`;
3. `npm run download:readium-cli -- --all`;
4. `npm run build`;
5. instalacao de dependencias opcionais da plataforma alvo com `npm --os/--cpu`;
6. `electron-builder`;
7. verificacao de artefatos e SHA256.

Os pacotes `voices/*.zip` sao incluidos em `resources/voices` em todos os alvos. A pasta
`voices/old` nao entra no bundle. Na primeira abertura do aplicativo empacotado, cada
pacote ausente e importado silenciosamente; nas aberturas seguintes, o bootstrap apenas
reconcilia os vinculos com motores TTS que tenham sido instalados desde a ultima execucao.
Quando um motor compativel e instalado com o aplicativo aberto, seus vinculos com todas
as vozes que possuem amostra tambem sao criados imediatamente, sem exigir reinicializacao.

Use `--skip-npm-ci` ou `--skip-build` apenas quando tiver certeza de que `node_modules/` e `out/` ja correspondem ao alvo.

Depois de um build cruzado, `node_modules/` pode ficar preparado para a plataforma alvo porque dependencias opcionais como `ffmpeg-static` e `node-llama-cpp` sao reinstaladas com `npm --os/--cpu`. Para voltar ao estado de desenvolvimento da maquina atual, rode `npm ci`.

## Alvos

### Linux AppImage

Comando nativo em Linux:

```bash
python3 scripts/build-bundle.py --target linux-appimage
```

Em Windows ou macOS, o build Linux precisa rodar dentro de Linux. O script suporta:

- WSL2 no Windows, com `--linux-runner wsl`;
- Docker no Windows/macOS/Linux, com `--linux-runner docker`;
- `--linux-runner auto`, que tenta WSL2 no Windows e depois Docker.

O runner Docker usa a imagem `node:25-bookworm`, monta o repositorio em `/workspace` e executa o mesmo script dentro do container. O script define a plataforma do container conforme `--arch`: `linux/amd64` para `--arch x64` e `linux/arm64` para `--arch arm64`. Em macOS Apple Silicon, o alvo padrao continua sendo `x64`; nesse caso, Docker usa emulacao amd64. Para gerar um AppImage ARM64, rode:

```bash
python3 scripts/build-bundle.py --target linux-appimage --arch arm64 --linux-runner docker
```

### Windows MSI

Comando:

```bash
python3 scripts/build-bundle.py --target windows-msi
```

O alvo `windows-msi` usa Wrapped MSI. Isso significa:

- o artefato publicado e `dist/DreamReader-<versao>-win-x64.msi`;
- o MSI contem um instalador NSIS gerado internamente;
- o instalador interno roda em modo silencioso com `/S`;
- por padrao, o script remove o `.exe` e o `.blockmap` intermediarios depois que o MSI e validado.

Use `--keep-intermediate` para manter esses arquivos de diagnostico.

Em Linux/macOS, `electron-builder` precisa de Wine para criar o instalador Windows. O script procura `wine` no `PATH` e tambem em caminhos comuns como `/opt/wine-devel/bin/wine`. Em Linux com `apt`, se Wine estiver ausente, o script tenta:

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine wine64 wine32
```

### macOS DMG

Comando:

```bash
python3 scripts/build-bundle.py --target mac-dmg
```

Bundles macOS exigem host macOS. Em Mac Apple Silicon, o alvo padrao para `mac-dmg` e `arm64`. Para pedir explicitamente um DMG Apple Silicon:

```bash
python3 scripts/build-bundle.py --target mac-dmg --arch arm64
```

Por padrao, o script desativa assinatura/notarizacao para builds locais (`-c.mac.identity=-`, `-c.mac.notarize=false`). Use `--signed-mac` para deixar a configuracao de assinatura do `electron-builder` ativa.

ZIP de macOS nao e exposto por este script. Ele costuma ser util para distribuicao por arquivo simples ou auto-update do Electron, mas nao faz parte do fluxo solicitado.

## Limitacoes conhecidas

- macOS DMG nao e gerado fora do macOS.
- Em Mac Apple Silicon, `mac-dmg` usa `arm64` por padrao; em outros hosts macOS, use `--arch arm64` para pedir DMG Apple Silicon.
- Linux AppImage fora do Linux exige WSL2 ou Docker.
- Em macOS Apple Silicon, Linux AppImage x64 via Docker depende de emulacao `linux/amd64`; use `--arch arm64` para build ARM64.
- Windows MSI fora do Windows exige Wine.
- O MSI e Wrapped MSI, nao um MSI com todos os arquivos da aplicacao declarados diretamente em tabelas WiX.
- Build Docker pode criar/alterar arquivos em `node_modules/`, `out/` e `dist/` dentro do volume montado. Em Linux/macOS, confira permissoes se o Docker rodar como root.
