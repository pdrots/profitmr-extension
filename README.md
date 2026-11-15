# ProfitMR

[Site ProfitMR](https://profitmr.vercel.app) · [Instalar no Firefox](https://addons.mozilla.org/pt-BR/firefox/addon/profitmr/)

ProfitMR é uma extensão Manifest V3 para Chrome, navegadores Chromium (incluindo Opera) e Firefox. A calculadora funciona de forma independente do site; a leitura opcional consulta os custos exibidos nas páginas de cartões do Microsoft Rewards. Projeto independente, sem afiliação ou endosso da Microsoft.

## Instalar para desenvolvimento

### Chrome, Edge e Opera

1. Abra `chrome://extensions`, `edge://extensions` ou `opera://extensions`.
2. Ative o **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação** e escolha a pasta deste projeto.
4. Abra a extensão pelo ícone do navegador.

### Firefox

1. No PowerShell, execute `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build-firefox.ps1` a partir da pasta da extensão. A opção `Bypass` se aplica somente a esse processo e não altera a política do sistema.
2. Abra `about:debugging#/runtime/this-firefox`.
3. Selecione **Carregar extensão temporária...** e escolha `dist\firefox\manifest.json`.
4. A extensão temporária permanece instalada até o Firefox ser fechado.

O manifesto principal usa service worker para Chrome e Opera. `manifest.firefox.json` usa scripts de background, suportados pelo Firefox, e o script de build monta uma cópia pronta para carregar sem alterar o manifesto Chromium.

O manifesto Firefox declara suporte ao Firefox para computador e Android a partir da versão 142. A interface e os fluxos principais ainda precisam ser testados em dispositivos Android antes de marcar essa plataforma como pronta para usuários.

Após alterar os arquivos, volte à página de extensões e selecione **Recarregar**. Feche e abra novamente o popup para conferir as alterações.

O popup inclui um link para o [site ProfitMR](https://profitmr.vercel.app), que abre em uma nova aba.

## Usar a calculadora

Informe o preço do jogo ou app e seu saldo de pontos. A extensão oferece tema claro/escuro, interface em português, inglês ou espanhol e cartões do Brasil (BRL), Estados Unidos (USD) ou Espanha (EUR). Os valores são salvos separadamente por região. Em qualquer uma das três regiões, abra **Atualizar custos automaticamente** e selecione **Ler custos no Rewards** para consultar os cartões em abas de fundo; a sessão do navegador precisa estar conectada. Confira os valores detectados antes de usar.

O custo do cartão personalizado corresponde ao valor de referência selecionado. Ao mudar esse valor, os pontos anteriores são apagados. Para comparar um valor personalizado com precisão, consulte no Rewards exatamente o valor pretendido. A calculadora pode estimar proporcionalmente os custos de outros valores e identifica essas estimativas no resultado. Confirme sempre o custo no Rewards antes de resgatar.

Se uma leitura ficar presa, use **Destravar / reiniciar leitura**. Isso fecha as abas abertas pela leitura e preserva os custos salvos. A leitura depende do conteúdo renderizado pelo site e pode não encontrar os valores; confira os resultados e, se necessário, tente novamente.

## Dados e permissões

Os valores da calculadora e o estado da leitura são salvos no armazenamento local da extensão. A extensão acessa as páginas de cartões em `https://rewards.bing.com/redeem/sku/` para ler os custos visíveis. Não lê nem armazena senhas ou cookies.

As permissões declaradas no manifesto são:

- `storage`: salvar valores e o progresso da leitura localmente.
- `alarms`: encerrar leituras que ultrapassem o tempo limite.
- acesso às páginas dos cartões no domínio Microsoft Rewards: abrir os cartões e ler o conteúdo renderizado.

## Arquivos

- `manifest.json`: manifesto da extensão.
- `popup.html`, `popup.css`, `popup.js`, `popup-data.js`: interface, calculadora e traduções.
- `regions.js`: moedas, denominações, limites e SKUs usados pelo popup, leitor e processo de fundo.
- `background.js`: leitura em segundo plano e estado persistente.
- `content.js`: leitura dos custos visíveis na página Rewards.
- `icon-*.png`: ícones da extensão em diferentes tamanhos.
- `store-assets/`: arquivos-fonte do ícone e capturas de demonstração para a página do AMO; as capturas usam valores fictícios.
