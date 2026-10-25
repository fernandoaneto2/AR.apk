// Metadados da obra exibidos na tela inicial. Trocar aqui ao usar outra arte
// (e regenerar o alvo com `npm run target -- --image ... --out ...`).
const base = import.meta.env.BASE_URL;

export const ARTWORK = {
  title: 'Campo Expandido nº 1',
  author: 'Arte original do projeto WebAR Arte Expandida',
  year: '2026',
  imageUrl: `${base}images/obra-original.jpg`,
  targetUrl: `${base}targets/obra-original.mind`,
  /** altura / largura da imagem-alvo (1600 / 1200). */
  aspect: 4 / 3,
  description:
    'Composição abstrata geométrica com formas, hachuras e traços. Na experiência, um icosaedro turquesa flutua sobre a obra, envolto por um anel em rotação, enquanto partículas sobem da superfície.',
} as const;
