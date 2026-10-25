# Backlog e recomendações

## Para fechar o M1 (POC)

- [ ] QA físico em iPhone Safari e Android Chrome (`tests/smoke-checklist.md`) com versões registradas.
- [ ] Imprimir a obra e medir: tempo de carga 4G, tempo até reconhecer, FPS, alcance útil de distância.
- [ ] Ajustar `filterMinCF`/`filterBeta`/`missTolerance` conforme jitter observado.
- [ ] Se carga em 4G > 8 s: recompilar o alvo a partir de imagem de 900 px e comparar estabilidade.

## M2 — Piloto (3–5 obras)

- Suporte a múltiplas obras por URL (`/obra/<slug>`) e configuração por JSON (título, autor, alvo, cena).
- Efeitos por obra (presets) e suporte a GLB otimizado (Meshopt/Draco, KTX2) em `public/models`.
- Áudio opcional com controle de som (desligado por padrão).
- QR Code por obra impresso junto à peça.
- Métricas agregadas e anônimas (sessão iniciada, alvo encontrado, erro por navegador) com consentimento quando exigido pela LGPD.
- Testar pinturas reais: tamanhos, verniz/brilho, iluminação de galeria.

## Fase 2 — Plataforma (apenas com aprovação)

- Next.js + Supabase (Auth, Postgres com RLS por proprietário, Storage com buckets privados para rascunhos).
- Editor visual: camadas, transformações XYZ, opacidade, animações, timeline básica, preview com câmera e simulado.
- Publicação com versões imutáveis de cena, rollback e URL estável.
- Compilação de alvos e otimização de modelos em jobs assíncronos.
- Validação de uploads (extensão, MIME, assinatura, tamanho), rate limiting e quotas.

## Dívida técnica conhecida

- MindAR 1.2.5 traz TF.js 4 inteiro no chunk do motor (~1 MB); avaliar build próprio ou motor alternativo.
- `Controller.dispose()` do MindAR não encerra o worker — fazemos `worker.terminate()` manualmente.
- Sem testes unitários ainda (lógica de estado/erros é pequena; candidatos: `classifyCameraError`, `TrackingStateMachine`).
