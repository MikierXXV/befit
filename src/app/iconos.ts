/**
 * Iconos de la barra, en SVG dibujado aquí.
 *
 * Trazos propios sobre una rejilla de 24 y no una librería de iconos: son seis, una librería trae
 * cientos y su licencia, y un emoji —☀, 📄— se dibuja distinto en cada sistema, en color en unos y
 * en negro en otros, y no sigue el color del tema. Estos heredan `currentColor` y el grosor de
 * trazo es el mismo en todos.
 *
 * Siempre decorativos (`aria-hidden`): el nombre lo lleva el botón, en su etiqueta accesible.
 */

const svg = (trazos: string): string =>
  `<svg class="icono-svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${trazos}</svg>`;

export const ICONOS = {
  /** Una hoja con la esquina doblada y dos renglones: los datos, como un documento que se guarda. */
  documento: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h6"/>'),
  /** Un globo con meridiano y ecuador: el idioma. */
  idioma: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 4 5.6 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.6-4-9s1.4-6.4 4-9z"/>'),
  /** Sol: se enseña en el tema oscuro, porque pulsarlo lleva al claro. */
  sol: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  /** Luna: se enseña en el claro, porque pulsarla lleva al oscuro. */
  luna: svg('<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/>'),
  /** Tres barras que suben: el progreso. */
  progreso: svg('<path d="M5 20v-6M12 20V9M19 20V4"/><path d="M3 20h18"/>'),
  /** Tres rayas: el menú con lo que no cabe en la barra del móvil. */
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  /** Aspa: cerrar el menú. */
  cerrar: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
