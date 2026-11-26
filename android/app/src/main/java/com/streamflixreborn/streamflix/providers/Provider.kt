package com.streamflixreborn.streamflix.providers

import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.Episode
import com.streamflixreborn.streamflix.models.Genre
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.People
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.plugins.StreamFormatHelper

interface Provider {

    val baseUrl: String
    val name: String
    val logo: String
    val language: String

    suspend fun getHome(): List<Category>

    suspend fun search(query: String, page: Int = 1): List<AppAdapter.Item>

    suspend fun getMovies(page: Int = 1): List<Movie>

    suspend fun getTvShows(page: Int = 1): List<TvShow>

    suspend fun getMovie(id: String): Movie

    suspend fun getTvShow(id: String): TvShow

    suspend fun getEpisodesBySeason(seasonId: String): List<Episode>

    suspend fun getGenre(id: String, page: Int = 1): Genre

    suspend fun getPeople(id: String, page: Int = 1): People

    suspend fun getServers(id: String, videoType: Video.Type): List<Video.Server>

    suspend fun getVideo(server: Video.Server): Video

    companion object {
        data class ProviderSupport(
            val movies: Boolean,
            val tvShows: Boolean,
        )

        val providers: Map<Provider, ProviderSupport> = linkedMapOf(
            TmdbProvider("es") to ProviderSupport(movies = true, tvShows = true),
            TmdbProvider("en") to ProviderSupport(movies = true, tvShows = true),
            TmdbProvider("it") to ProviderSupport(movies = true, tvShows = true),
            TmdbProvider("fr") to ProviderSupport(movies = true, tvShows = true),
            TmdbProvider("de") to ProviderSupport(movies = true, tvShows = true),
            TmdbProvider("pt") to ProviderSupport(movies = true, tvShows = true),
        )

        fun defaultCatalogProvider(preferredLanguage: String? = null): TmdbProvider {
            val code = preferredLanguage
                ?.lowercase()
                ?.substringBefore('-')
                ?.substringBefore('_')
                ?.takeIf { it in setOf("es", "en", "it", "fr", "de", "pt") }
                ?: "es"
            return TmdbProvider(code)
        }

        fun playableServers(servers: List<Video.Server>): List<Video.Server> =
            StreamFormatHelper.sanitizeServers(servers)

        fun supportsMovies(provider: Provider): Boolean =
            providers[provider]?.movies ?: true

        fun supportsTvShows(provider: Provider): Boolean =
            providers[provider]?.tvShows ?: true

        fun findByName(name: String): Provider? {
            providers.keys.find { it.name.equals(name, ignoreCase = true) }?.let { return it }
            if (name.startsWith("TMDb (", ignoreCase = true)) {
                val lang = name.substringAfter('(').substringBefore(')').trim()
                if (lang.isNotEmpty()) return TmdbProvider(lang)
            }
            return null
        }
    }
}
