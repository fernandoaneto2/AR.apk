# Compilação do alvo (.mind)

| Item | Valor |
| --- | --- |
| Fonte | `public/images/obra-original.jpg` (1200×1600, JPEG q90), rasterizado de `obra-original.svg` |
| Gerador da arte | `scripts/generate-art.mjs`, seed `2026` (determinístico) |
| Compilador | `Compiler` de `mind-ar@1.2.5` (`dist/mindar-image.prod.js`) — mesma versão do runtime |
| Execução | Chromium headless via Playwright (`scripts/compile-target.mjs`) |
| Saída | `public/targets/obra-original.mind` (~930 KB, 1 alvo, targetIndex 0) |

## Regenerar

```bash
npm run art      # opcional: só se mudar a arte
npm run target
```

Outra imagem:

```bash
node scripts/compile-target.mjs --image public/images/minha-obra.jpg --out public/targets/minha-obra.mind
```

Depois atualize `src/config.ts` (`imageUrl`, `targetUrl`, `aspect`).

## Alternativa sem Playwright

Ferramenta oficial no navegador: <https://hiukim.github.io/mind-ar-js-doc/tools/compile> — enviar o JPG, baixar o `.mind` e salvar em `public/targets/`. Confirme que a ferramenta usa a mesma versão major/minor do MindAR do projeto.

## Boas práticas para a imagem

- Proporção igual à da peça impressa; sem margens brancas extras.
- Muitos cantos e detalhes de alto contraste distribuídos; evitar áreas lisas grandes e padrões repetitivos.
- 1000–2000 px no maior lado é suficiente; imagens maiores só aumentam o tempo de compilação e o arquivo.
- Ao trocar a arte, recompile **sempre** — o `.mind` é específico da imagem.
