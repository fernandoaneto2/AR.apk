import './styles/main.css';
import './styles/print.css';
import { ARTWORK } from './config';
import { experienceUrl, qrSvg } from './ui/qr';

const $ = (id: string) => document.getElementById(id)!;
const url = experienceUrl();

const art = $('sheet-art') as HTMLImageElement;
// PNG sem perdas para impressão (o JPG é usado na tela).
art.src = ARTWORK.imageUrl.replace(/\.jpg$/, '.png');
art.alt = `${ARTWORK.title}: obra-alvo para a experiência em realidade aumentada`;
$('sheet-title').textContent = ARTWORK.title;
$('sheet-meta').textContent = `${ARTWORK.author} · ${ARTWORK.year}`;
$('sheet-url').textContent = url;
$('btn-print').addEventListener('click', () => window.print());

qrSvg(url).then((svg) => ($('sheet-qr').innerHTML = svg));
