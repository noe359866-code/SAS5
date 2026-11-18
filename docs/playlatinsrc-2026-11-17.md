# Fuentes directas seleccionadas

El addon conserva dos fuentes de reproducción en español latino: Fanpelis, que descubre títulos por nombre traducido, y PlayLatinSRC, que identifica por IMDb. Ambas se consultan en paralelo, no requieren claves y no ejecutan pruebas de trabajo de alto consumo.

PlayLatinSRC solo publica las versiones marcadas como Latino. Fanpelis también exige evidencia de idioma y una URL reproducible; las opciones en inglés, duales, castellanas y las descargas se descartan.

Los detalles de extracción y validación están cubiertos por `test/fanpelis.test.js` y `test/playlatin.test.js`.
