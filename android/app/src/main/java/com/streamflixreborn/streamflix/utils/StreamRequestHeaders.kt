package com.streamflixreborn.streamflix.utils

import java.util.Locale

/**
 * Cabeceras con las que la app pide las páginas de los plugins y los streams.
 *
 * Los 403 de los hosts no suelen ser "bloqueos" del contenido: son checks de
 * *hotlink* y de *fingerprint*. El servidor compara lo que manda la app con lo
 * que manda un navegador y, si no se parece, responde 403. Los tres disparadores
 * típicos que teníamos:
 *
 * 1. `User-Agent: okhttp/4.x` en el propio vídeo (el reproductor lo forzaba
 *    aunque el cliente ya tuviera un UA de Chrome móvil).
 * 2. `Accept: text/html…`, `Sec-Fetch-Dest: document` y `Sec-Fetch-Mode: navigate`
 *    en peticiones de media, que un `<video>` nunca envía.
 * 3. Falta de `Referer`/`Origin` cuando el plugin no los devolvía: casi todos los
 *    CDN exigen que la petición venga "desde" el sitio que la publica.
 *
 * Aquí se arma un juego de cabeceras coherente de navegador móvil, respetando
 * siempre lo que devuelva el plugin (sus cabeceras tienen prioridad), y sin
 * duplicar nombres con distinta capitalización.
 */
object StreamRequestHeaders {

    /** UA de Chrome móvil: el mismo para páginas, API y media. */
    const val USER_AGENT =
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

    const val ACCEPT_LANGUAGE = "es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7"

    private val ORIGIN_REGEX = Regex("^https?://[^/?#\\s]+", RegexOption.IGNORE_CASE)

    /**
     * Cabeceras para una petición de media (vídeo, HLS, DASH, subtítulos).
     *
     * Diferencia clave con una petición de página: `Accept: */*`,
     * `Sec-Fetch-Dest: video` y `Sec-Fetch-Mode: no-cors`, que es lo que envía
     * el elemento `<video>` del navegador. `Referer`/`Origin` salen de las
     * cabeceras del plugin; si no las trae, se derivan del propio host del
     * stream para superar el hotlink check.
     */
    fun forMedia(url: String, pluginHeaders: Map<String, String>?): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        setIfAbsent(headers, "User-Agent", USER_AGENT)
        setIfAbsent(headers, "Accept", "*/*")
        setIfAbsent(headers, "Accept-Language", ACCEPT_LANGUAGE)
        setIfAbsent(headers, "Sec-Fetch-Dest", "video")
        setIfAbsent(headers, "Sec-Fetch-Mode", "no-cors")
        setIfAbsent(headers, "Sec-Fetch-Site", "cross-site")

        pluginHeaders?.forEach { (name, value) -> set(headers, name, value) }

        val referer = get(headers, "Referer") ?: originOf(url)?.let { "$it/" }
        if (referer != null) setIfAbsent(headers, "Referer", referer)

        val origin = get(headers, "Origin") ?: referer?.let { originOf(it) }
        if (origin != null) setIfAbsent(headers, "Origin", origin)

        return headers
    }

    /**
     * Cabeceras para `fetch`/`axios` dentro del motor de plugins (páginas HTML,
     * API JSON, manifiestos…). Mismo UA de navegador y `XHR-like`, con `Origin`
     * en los métodos que lo envían de verdad.
     */
    fun forPluginFetch(
        url: String,
        method: String = "GET",
        pluginHeaders: Map<String, String>?,
    ): Map<String, String> {
        val headers = LinkedHashMap<String, String>()
        setIfAbsent(headers, "User-Agent", USER_AGENT)
        setIfAbsent(headers, "Accept", "*/*")
        setIfAbsent(headers, "Accept-Language", ACCEPT_LANGUAGE)
        setIfAbsent(headers, "Sec-Fetch-Dest", "empty")
        setIfAbsent(headers, "Sec-Fetch-Mode", "cors")
        setIfAbsent(headers, "Sec-Fetch-Site", "cross-site")

        pluginHeaders?.forEach { (name, value) -> set(headers, name, value) }

        val referer = get(headers, "Referer") ?: originOf(url)?.let { "$it/" }
        if (referer != null) setIfAbsent(headers, "Referer", referer)

        val sendsOrigin = !method.equals("GET", ignoreCase = true) &&
            !method.equals("HEAD", ignoreCase = true)
        if (sendsOrigin) {
            val origin = get(headers, "Origin") ?: referer?.let { originOf(it) }
            if (origin != null) setIfAbsent(headers, "Origin", origin)
        }

        return headers
    }

    /** `https://host:puerto` de una URL o de un `Referer`; `null` si no es http(s). */
    fun originOf(url: String?): String? {
        val trimmed = url?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        return ORIGIN_REGEX.find(trimmed)?.value?.lowercase(Locale.ROOT)
    }

    /** Cabecera buscada sin distinguir mayúsculas (`Referer` == `referer`). */
    fun get(headers: Map<String, String>, name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value

    /** Asigna respetando lo que ya hubiera con otra capitalización. */
    private fun set(headers: MutableMap<String, String>, name: String, value: String) {
        if (name.isBlank() || value.isBlank()) return
        headers.keys.filter { it.equals(name, ignoreCase = true) }.forEach { headers.remove(it) }
        headers[name] = value
    }

    private fun setIfAbsent(headers: MutableMap<String, String>, name: String, value: String) {
        if (get(headers, name) == null) headers[name] = value
    }
}
