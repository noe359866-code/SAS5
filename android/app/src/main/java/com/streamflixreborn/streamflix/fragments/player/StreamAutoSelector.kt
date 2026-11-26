package com.streamflixreborn.streamflix.fragments.player

import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.plugins.StreamFormatHelper
import java.util.Locale

/**
 * Elige el stream que se va a reproducir sin preguntar nada al usuario.
 *
 * El usuario sólo pulsa "Ver ahora" / "Watch": el reproductor abre el primer
 * servidor de esta lista y, si falla, encadena el siguiente. Aquí se decide ese
 * orden sin conocer ningún proveedor concreto, usando sólo lo que ya viene en
 * `Video.Server` (`name`, `src` y el `video` ya resuelto por el plugin).
 *
 * Prioridades, de más a menos peso:
 *
 * 1. **Formato**: MP4/MKV (progresivo, sin manifiesto) > HLS > DASH > endpoint
 *    directo sin extensión > página `/embed/` o `/e/` que necesitaría extractor.
 *    ExoPlayer abre los tres primeros sin ayuda y son los que menos fallan a
 *    mitad de reproducción.
 * 2. **Calidad** anunciada en el nombre o en la URL (4K > 1080p > 720p > SD).
 * 3. **Idioma** (latino > castellano > subtitulado).
 * 4. **HTTPS** (con HTTP plano muchos hosts fallan por cleartext).
 * 5. **Host que ya funcionó** con este proveedor y hosts que fallaron en esta
 *    sesión (se hunden al final para que el reintento elija otro).
 */
object StreamAutoSelector {

    /**
     * Formatos que el reproductor sabe abrir, con el peso que reciben al
     * ordenar. El valor es positivo para lo que se reproduce directamente y
     * negativo para lo que obliga a pasar por una página intermedia.
     */
    enum class StreamFormat(val label: String, val score: Int) {
        MP4("MP4", 70),
        MKV("MKV", 66),
        WEBM("WEBM", 60),
        HLS("HLS", 55),
        DASH("DASH", 40),
        DIRECT("Directo", 25),
        // Página intermedia (`/embed/`, `/e/`): ExoPlayer no la abre sin un extractor,
        // así que queda siempre por detrás de cualquier stream reproducible.
        LINK("Enlace", -100),
    }

    private const val SCORE_4K = 45
    private const val SCORE_1080 = 35
    private const val SCORE_720 = 20
    private const val SCORE_SD = -25
    private const val SCORE_LATINO = 30
    private const val SCORE_CASTELLANO = 22
    private const val SCORE_SUBTITLED = 6
    private const val SCORE_HTTPS = 12
    private const val SCORE_LAST_GOOD = 200
    private const val SCORE_DEAD_HOST = -80

    /**
     * Ordena la lista de mejor a peor. El orden original se conserva entre
     * servidores con el mismo puntaje (orden estable), para que el resultado sea
     * predecible y no "bailen" los reintentos.
     */
    fun order(servers: List<Video.Server>, lastGoodHost: String? = null): List<Video.Server> =
        servers
            .withIndex()
            .sortedWith(
                compareByDescending<IndexedValue<Video.Server>> { score(it.value, lastGoodHost) }
                    .thenBy { it.index }
            )
            .map { it.value }

    /** URL que realmente se va a reproducir (el plugin ya resuelve `video`). */
    fun streamUrl(server: Video.Server): String =
        server.video?.source?.takeIf { it.isNotBlank() } ?: server.src.ifBlank { server.id }

    /**
     * Formato de un servidor. Se apoya en el MIME declarado por el plugin
     * (`video.type`) y, si no lo hay, en la extensión/patrón de la URL, así que
     * funciona igual con `master.m3u8?token=…` o con URLs sin extensión.
     */
    fun formatOf(server: Video.Server): StreamFormat {
        val url = streamUrl(server)
        val mime = StreamFormatHelper.inferMimeType(url, server.video?.type)?.lowercase(Locale.ROOT)
        return when {
            mime == null ->
                if (StreamFormatHelper.isDirectMedia(url)) StreamFormat.DIRECT else StreamFormat.LINK

            mime.contains("mpegurl") || mime.contains("m3u8") -> StreamFormat.HLS
            mime.contains("dash") || mime.contains("mpd") -> StreamFormat.DASH
            mime.contains("matroska") || mime.contains("mkv") -> StreamFormat.MKV
            mime.contains("webm") -> StreamFormat.WEBM
            mime.contains("mp4") || mime.contains("m4v") || mime.contains("quicktime") -> StreamFormat.MP4
            else -> StreamFormat.DIRECT
        }
    }

    /** Etiqueta corta del formato: `MP4`, `HLS`, `DASH`, ... */
    fun formatLabel(server: Video.Server): String = formatOf(server).label

    /** Calidad anunciada en el nombre o la URL, si el plugin la incluye. */
    fun qualityLabel(server: Video.Server): String? {
        val haystack = "${server.name} ${streamUrl(server)}".lowercase(Locale.ROOT)
        return when {
            haystack.contains("2160") || haystack.contains("4k") -> "4K"
            haystack.contains("1080") || haystack.contains("fullhd") -> "1080p"
            haystack.contains("720") || haystack.contains(" hd") -> "720p"
            haystack.contains("480") -> "480p"
            haystack.contains("360") -> "360p"
            else -> null
        }
    }

    /**
     * Texto para el encabezado del reproductor, p. ej. `MP4 1080p`, para que se
     * vea qué eligió el modo automático sin abrir Ajustes.
     */
    fun autoDescription(server: Video.Server): String =
        listOfNotNull(formatLabel(server), qualityLabel(server))
            .joinToString(" ")
            .trim()

    /** Identificador estable de un servidor para recordar "este funcionó". */
    fun hostKey(server: Video.Server): String =
        (server.src.ifBlank { server.id })
            .substringAfter("://", "")
            .substringBefore("/")
            .substringBefore("?")
            .lowercase()

    internal fun score(server: Video.Server, lastGoodHost: String?): Int {
        val url = streamUrl(server)
        val haystack = "${server.name} $url".lowercase(Locale.ROOT)

        // 1. Formato: un MP4/HLS directo se reproduce sin pasar por un extractor.
        var score = formatOf(server).score

        // 2. Calidad anunciada en el nombre o en la URL.
        score += when (qualityLabel(server)) {
            "4K" -> SCORE_4K
            "1080p" -> SCORE_1080
            "720p" -> SCORE_720
            "480p", "360p" -> SCORE_SD
            else -> 0
        }

        // 3. Idioma: latino > castellano > subtitulado.
        score += when {
            haystack.contains("latino") || haystack.contains("latam") -> SCORE_LATINO
            haystack.contains("castellano") || haystack.contains("español") ||
                haystack.contains("espanol") -> SCORE_CASTELLANO
            haystack.contains("sub") -> SCORE_SUBTITLED
            else -> 0
        }

        // 4. HTTPS: con HTTP plano muchos hosts fallan por cleartext.
        if (url.startsWith("https://")) score += SCORE_HTTPS

        // 5. Host que ya reprodujo bien con este proveedor.
        if (!lastGoodHost.isNullOrBlank() && hostKey(server) == lastGoodHost) {
            score += SCORE_LAST_GOOD
        }

        // 6. Hosts que el player ya marcó como problemáticos en esta sesión.
        if (hostKey(server) in deadHosts) score += SCORE_DEAD_HOST

        return score
    }

    /**
     * Hosts que fallaron al reproducir en esta sesión. Vive en memoria: si el
     * primer intento de un host falla, el reintento lo pone al final.
     */
    private val deadHosts = mutableSetOf<String>()

    fun markFailed(server: Video.Server) {
        if (deadHosts.size > 40) deadHosts.clear()
        deadHosts += hostKey(server)
    }

    fun markWorked(server: Video.Server) {
        deadHosts -= hostKey(server)
    }

    @Suppress("unused")
    fun clearSession() = deadHosts.clear()
}
