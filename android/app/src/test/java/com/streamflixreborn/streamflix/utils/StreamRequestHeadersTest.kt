package com.streamflixreborn.streamflix.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cabeceras con las que se piden páginas y streams. Es la primera defensa contra
 * los 403 de los hosts (hotlink check + fingerprint), así que si cambian aquí el
 * reproductor empieza a fallar en producción.
 */
class StreamRequestHeadersTest {

    @Test
    fun `el media se pide como un navegador movil y no como okhttp`() {
        val headers = StreamRequestHeaders.forMedia("https://cdn.example.com/hls/master.m3u8?t=1", null)

        assertTrue(headers.getValue("User-Agent").startsWith("Mozilla/5.0 (Linux; Android"))
        assertEquals("*/*", headers.getValue("Accept"))
        assertEquals("video", headers.getValue("Sec-Fetch-Dest"))
        assertEquals("no-cors", headers.getValue("Sec-Fetch-Mode"))
        assertEquals("https://cdn.example.com/", headers.getValue("Referer"))
        assertEquals("https://cdn.example.com", headers.getValue("Origin"))
    }

    @Test
    fun `las cabeceras del plugin mandan sobre las de la app`() {
        val headers = StreamRequestHeaders.forMedia(
            "https://cdn.example.com/a.mp4",
            mapOf("User-Agent" to "CustomAgent/1.0", "Referer" to "https://otro.example/"),
        )

        assertEquals("CustomAgent/1.0", headers.getValue("User-Agent"))
        assertEquals("https://otro.example/", headers.getValue("Referer"))
        // El Origin se deriva del Referer del plugin, no del host del stream.
        assertEquals("https://otro.example", headers.getValue("Origin"))
    }

    @Test
    fun `no se duplica referer si el plugin lo manda en minusculas`() {
        val headers = StreamRequestHeaders.forMedia(
            "https://cdn.example.com/a.mp4",
            mapOf("referer" to "https://sitio.example/player"),
        )

        assertEquals(1, headers.keys.count { it.equals("referer", ignoreCase = true) })
        assertEquals("https://sitio.example/player", StreamRequestHeaders.get(headers, "Referer"))
        assertEquals("https://sitio.example", StreamRequestHeaders.get(headers, "Origin"))
    }

    @Test
    fun `el fetch del plugin usa cabeceras de xhr y origin solo cuando toca`() {
        val get = StreamRequestHeaders.forPluginFetch("https://api.example.com/v1/list", "GET", emptyMap())
        assertEquals("empty", get.getValue("Sec-Fetch-Dest"))
        assertEquals("cors", get.getValue("Sec-Fetch-Mode"))
        assertEquals("https://api.example.com/", get.getValue("Referer"))
        assertNull(StreamRequestHeaders.get(get, "Origin"))

        val post = StreamRequestHeaders.forPluginFetch("https://api.example.com/v1/resolve", "POST", emptyMap())
        assertEquals("https://api.example.com/", post.getValue("Referer"))
        assertEquals("https://api.example.com", post.getValue("Origin"))
    }

    @Test
    fun `el accept del plugin se respeta`() {
        val headers = StreamRequestHeaders.forPluginFetch(
            "https://api.example.com/x",
            "GET",
            mapOf("Accept" to "application/json", "Accept-Language" to "en"),
        )

        assertEquals("application/json", headers.getValue("Accept"))
        assertEquals("en", headers.getValue("Accept-Language"))
    }

    @Test
    fun `originOf ignora esquemas que no son http`() {
        assertNull(StreamRequestHeaders.originOf("magnet:?xt=urn:btih:deadbeef"))
        assertNull(StreamRequestHeaders.originOf("data:application/vnd.apple.mpegurl;base64,AAAA"))
        assertNull(StreamRequestHeaders.originOf(""))
        assertEquals("http://127.0.0.1:8080", StreamRequestHeaders.originOf("http://127.0.0.1:8080/hls/master.m3u8"))
    }
}
