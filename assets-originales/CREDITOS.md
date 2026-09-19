# Créditos de los modelos originales

Cada modelo descargado se anota aquí **antes** de convertirlo. Casi todos vienen con licencia CC BY,
que obliga a atribuir y a **declarar las modificaciones**: el comando de conversión que aparece en
cada entrada es esa declaración, y por eso se copia literal.

Los originales no se versionan (ver `.gitignore`): pesan megas y el que sirve el sitio es el
convertido, que sí está en `public/modelos/`.

## Plantilla de entrada

### `nombre-del-modelo.glb`

- **Autor:** …
- **Fuente:** https://…
- **Licencia:** CC BY 4.0
- **Modificaciones:** texturas descartadas, malla diezmada de 51.000 a 25.000 triángulos con métrica
  de error, geometría cuantizada y comprimida con meshopt.
- **Comando:**
  ```
  node scripts/optimizar-modelo.mjs assets-originales/nombre-del-modelo.glb public/modelos/nombre.glb --sin-texturas --triangulos 25000
  ```
