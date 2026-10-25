# Checklist de QA — dispositivos reais

> **Status: PENDENTE.** Nenhum teste em iPhone/Android físico foi feito pelo agente (sem acesso a aparelhos). Os testes automatizados estão no fim deste arquivo.

## Preparação

- Obra impressa: `public/images/obra-original.png`, A4 ou maior, papel fosco, plana.
- URL HTTPS de produção (ou `npm run dev:https`). Teste também com `?debug=1` para ver FPS e o contorno de registro.
- Registre para cada aparelho:

| Campo | iPhone | Android |
| --- | --- | --- |
| Modelo | | |
| Sistema (iOS/Android) | | |
| Navegador + versão | Safari | Chrome |
| Rede (Wi-Fi/4G) | | |
| Data / testador | | |

## Matriz (plano mestre, seção 08)

Resultado: ✅ ok · ⚠️ ok com ressalva (descrever) · ❌ falhou (descrever, anexar print/vídeo).

| # | Caso | Procedimento | Esperado | iPhone | Android |
| --- | --- | --- | --- | --- | --- |
| 1 | Permissão negada | Iniciar › **Negar** câmera | Tela "Acesso à câmera negado" com passos; botão "Tentar novamente" | | |
| 2 | Permissão recuperada | Liberar nas configurações › Tentar novamente | Câmera abre, "Procurando a obra…" | | |
| 3 | Alvo | Apontar para a impressão | "Obra reconhecida"; 3D sobre a obra, centrado (contorno de debug coincide com a borda) | | |
| 4 | Movimento | Mover a câmera devagar, inclinar ~30° | 3D acompanha sem deslocar; anotar jitter | | |
| 5 | Oclusão | Cobrir ~1/3 da obra com a mão, depois descobrir | Pode perder; recupera quando visível | | |
| 6 | Perda | Tirar a obra do quadro | 3D some (nada "preso" na tela); "Obra perdida de vista" | | |
| 7 | Retorno | Apontar de novo | 3D reaparece com animação de entrada | | |
| 8 | Luz | Sombra parcial; luz indireta fraca; luz forte com reflexo | Documentar em quais condições funciona | | |
| 9 | Distância | Aproximar (< 15 cm) e afastar (> 1,5 m) | Dicas "Aproxime-se"/"Afaste-se" enquanto rastreia; anotar alcance útil | | |
| 10 | Orientação | Girar para paisagem e voltar | UI e 3D consistentes; rastreamento retoma em poucos segundos | | |
| 11 | Saída | Botão X | Volta ao início; **indicador de câmera do sistema apaga** | | |
| 12 | Segundo plano | Trocar de app e voltar | Retoma sem travar | | |
| 13 | Rede | Primeira carga em 4G e em Wi-Fi (aba anônima) | Sem erros silenciosos; anotar tempo até "Procurando" | | |
| 14 | Demo | "Ver demonstração sem câmera" | Obra em 3D com efeitos, arrastar gira | | |
| 15 | Acessibilidade | Ativar "Reduzir movimento" no sistema | Animações mais lentas, menos partículas | | |
| 16 | QR / impressão | Abrir a página no computador; ler o QR com o celular; imprimir `/imprimir.html` | QR abre a experiência; folha A4 em 1 página | | |

## Cadastro de obra própria e IA

| # | Caso | Procedimento | Esperado | iPhone | Android |
| --- | --- | --- | --- | --- | --- |
| C1 | Foto pela câmera | Cadastrar › Fotografar uma pintura na parede | Cantos detectados (ou mensagem pedindo ajuste); recorte correto | | |
| C2 | Galeria | Escolher um arquivo digital da obra | "Usar imagem inteira" funciona | | |
| C3 | Tempo | Medir do toque em "Criar experiência" até a tela da obra | ≤ 40 s; anotar | | |
| C4 | IA | Com `ANTHROPIC_API_KEY` na Vercel | Título, descrição, legenda e efeitos coerentes com a obra | | |
| C5 | Sem IA | Desmarcar IA | Cena local; nenhuma chamada a /api/analyze | | |
| C6 | Nota | Comparar nota de foto boa vs. foto escura/torta | Nota e dicas mudam de forma coerente | | |
| C7 | Reconhecer | Apontar para a obra cadastrada | Reconhece; legenda; camadas alinhadas | | |
| C8 | Várias obras | Cadastrar 2–3 obras e usar "Apontar para uma obra" | Cada uma é reconhecida com seus efeitos | | |
| C9 | Dicas da câmera | Ambiente escuro / reflexo / mexer o celular | Dica correspondente aparece | | |
| C10 | Persistência | Fechar e reabrir o navegador | Obras continuam na galeria | | |

## Medições (metas iniciais, não garantias)

| Métrica | Meta | iPhone | Android |
| --- | --- | --- | --- |
| Tempo até "Procurando a obra…" (1ª carga, 4G) | ≤ 8 s | | |
| Tempo do apontar até "Obra reconhecida" | ≤ 2 s | | |
| FPS com obra rastreada (`?debug=1`) | ≥ 30 | | |
| Aquecimento após 3 min | aceitável | | |

## Testes automatizados (executados pelo agente)

| Teste | Comando | Resultado |
| --- | --- | --- |
| Typecheck strict | `npm run typecheck` | ✅ sem erros |
| Unitários (máquina de estados, classificação de erros da câmera) | `npm test` | ✅ 14/14 |
| Build de produção | `npm run build` | ✅ |
| E2E com câmera simulada (Chromium headless, vídeo `.y4m` com a obra aparecendo/sumindo) | `npm run test:e2e` | ✅ scanning → found → lost → found; câmera encerrada ao sair; modo demo; zero violações de CSP |
| Mesmo E2E contra produção (Vercel, cabeçalhos reais) | `npm run test:e2e -- --url https://webar-arte-expandida.vercel.app` | ✅ found em 3,0 s; lost/found coerentes; zero violações de CSP |

O E2E prova a integração (alvo compilado ↔ motor ↔ eventos ↔ UI), **não** o comportamento óptico real (foco, reflexo, ruído de sensor, desempenho de GPU móvel).
