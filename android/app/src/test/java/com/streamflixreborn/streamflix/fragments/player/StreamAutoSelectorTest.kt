package com.streamflixreborn.streamflix.fragments.player

import com.streamflixreborn.streamflix.models.Video
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * El usuario nunca elige servidor: el primero de la lista es el que se reproduce,
 * así que este orden es el comportamiento visible del reproductor.
 */
class StreamAutoSelectorTest {

    private fun server(id: String, name: String, src: String = id) = Video.Server(id, name, src)

    /** Servidor tal como lo entrega un plugin: con el `video` ya resuelto. */
    private fun resolvedServer(id: String, name: String, src: String, type: String? = null) =
        Video.Server(id, name, src).apply {
            video = Video(source = src, type = type)
        }

    @Test
    fun `sin tocar nada se elige MP4 antes que HLS y DASH`() {
        val dash = resolvedServer("1", "Servidor", "https://cdn.example.com/manifest.mpd")
        val hls = resolvedServer("2", "Servidor", "https://cdn.example.com/master.m3u8?token=abc")
        val mp4 = resolvedServer("3", "Servidor", "https://cdn.example.com/movie-1080p.mp4")

        assertEquals(
            listOf(mp4, hls, dash),
            StreamAutoSelector.order(listOf(dash, hls, mp4))
        )
        assertEquals("MP4", StreamAutoSelector.formatLabel(mp4))
        assertEquals("HLS", StreamAutoSelector.formatLabel(hls))
        assertEquals("DASH", StreamAutoSelector.formatLabel(dash))
    }

    @Test
    fun `el mime que declara el plugin manda sobre la extension de la url`() {
        // URL sin extensión, pero el plugin declara HLS: no debe quedar como "Enlace".
        val declaredHls = resolvedServer(
            "1",
            "Plugin",
            "https://cdn.example.com/live/uuid-1234",
            type = "hls",
        )
        val unknownLink = resolvedServer("2", "Plugin", "https://otro.example.com/e/abc")
        assertEquals("HLS", StreamAutoSelector.formatLabel(declaredHls))
        assertEquals(listOf(declaredHls, unknownLink), StreamAutoSelector.order(listOf(unknownLink, declaredHls)))
    }

    @Test
    fun `un m3u8 directo gana a un mp4 de menos calidad`() {
        val mp4Sd = resolvedServer("1", "Servidor 480p", "https://cdn.example.com/movie-480p.mp4")
        val hlsHd = resolvedServer("2", "Servidor 1080p", "https://cdn.example.com/master.m3u8")
        // El formato pesa, pero la calidad puede compensar: este caso documenta la
        // decisión (1080p HLS por delante de 480p MP4).
        assertEquals(listOf(hlsHd, mp4Sd), StreamAutoSelector.order(listOf(mp4Sd, hlsHd)))
    }

    @Test
    fun `la descripcion automatica muestra formato y calidad`() {
        val full = resolvedServer("1", "Direct CDN - 1080p", "https://cdn.example.com/movie.mp4")
        val noQuality = resolvedServer("2", "Servidor", "https://cdn.example.com/master.m3u8")
        assertEquals("MP4 1080p", StreamAutoSelector.autoDescription(full))
        assertEquals("HLS", StreamAutoSelector.autoDescription(noQuality))
    }

    @Test
    fun `una pagina embed queda por detras de cualquier stream directo`() {
        val embed = resolvedServer("1", "Filemoon 1080p latino", "https://filemoon.sx/e/abc123")
        val plainHls = resolvedServer("2", "Player 480p", "https://cdn.example.com/master.m3u8")
        assertEquals(listOf(plainHls, embed), StreamAutoSelector.order(listOf(embed, plainHls)))
    }

    @Test
    fun `un HLS directo gana a un enlace de player`() {
        val embed = server("1", "Filemoon", "https://filemoon.sx/e/abc123")
        val hls = server("2", "Stream", "https://cdn.example.com/master.m3u8")
        assertEquals(listOf(hls, embed), StreamAutoSelector.order(listOf(embed, hls)))
    }

    @Test
    fun `1080p gana a 480p con el mismo tipo`() {
        val sd = server("1", "Player 480p", "https://a.example.com/e/1")
        val hd = server("2", "Player 1080p", "https://b.example.com/e/2")
        assertEquals(listOf(hd, sd), StreamAutoSelector.order(listOf(sd, hd)))
    }

    @Test
    fun `latino gana a castellano y a subtitulado`() {
        val sub = server("1", "Player (sub)", "https://a.example.com/e/1")
        val cas = server("2", "Player castellano", "https://b.example.com/e/2")
        val lat = server("3", "Player latino", "https://c.example.com/e/3")
        assertEquals(listOf(lat, cas, sub), StreamAutoSelector.order(listOf(sub, cas, lat)))
    }

    @Test
    fun `https gana a http plano`() {
        val http = server("1", "Player", "http://a.example.com/e/1")
        val https = server("2", "Player", "https://b.example.com/e/2")
        assertEquals(listOf(https, http), StreamAutoSelector.order(listOf(http, https)))
    }

    @Test
    fun `el ultimo host que funciono va primero`() {
        val a = server("1", "Player 1080p", "https://a.example.com/e/1")
        val b = server("2", "Player 1080p", "https://b.example.com/e/2")
        val ordered = StreamAutoSelector.order(listOf(a, b), lastGoodHost = "b.example.com")
        assertEquals(b, ordered.first())
    }

    @Test
    fun `un host que fallo cae al final aunque sea mejor`() {
        val good = server("1", "Player 1080p", "https://dead.example.com/e/1")
        val meh = server("2", "Player 480p", "https://ok.example.com/e/2")
        StreamAutoSelector.markFailed(good)
        try {
            assertEquals(listOf(meh, good), StreamAutoSelector.order(listOf(good, meh)))
        } finally {
            StreamAutoSelector.markWorked(good)
        }
    }

    @Test
    fun `el orden es estable entre servidores equivalentes`() {
        val a = server("1", "A", "https://a.example.com/e/1")
        val b = server("2", "B", "https://b.example.com/e/2")
        val c = server("3", "C", "https://c.example.com/e/3")
        assertTrue(StreamAutoSelector.order(listOf(a, b, c)).map { it.id } == listOf("1", "2", "3"))
    }

    @Test
    fun `hostKey ignora esquema, ruta y query`() {
        assertEquals(
            "cdn.example.com",
            StreamAutoSelector.hostKey(server("x", "x", "https://cdn.example.com/live/play.m3u8?t=1"))
        )
    }
}
