package com.streamflixreborn.streamflix.adapters.viewholders

import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.navigation.findNavController
import androidx.preference.PreferenceManager
import androidx.recyclerview.widget.RecyclerView
import androidx.viewbinding.ViewBinding
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.databinding.ContentMovieCastMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentMovieDirectorsMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentMovieMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentMovieRecommendationsMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemCategorySwiperMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemMovieGridMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemMovieMobileBinding
import com.streamflixreborn.streamflix.fragments.genre.GenreMobileFragment
import com.streamflixreborn.streamflix.fragments.genre.GenreMobileFragmentDirections
import com.streamflixreborn.streamflix.fragments.home.HomeMobileFragment
import com.streamflixreborn.streamflix.fragments.home.HomeMobileFragmentDirections
import com.streamflixreborn.streamflix.fragments.movie.MovieMobileFragment
import com.streamflixreborn.streamflix.fragments.movie.MovieMobileFragmentDirections
import com.streamflixreborn.streamflix.fragments.movies.MoviesMobileFragment
import com.streamflixreborn.streamflix.fragments.movies.MoviesMobileFragmentDirections
import com.streamflixreborn.streamflix.fragments.people.PeopleMobileFragment
import com.streamflixreborn.streamflix.fragments.people.PeopleMobileFragmentDirections
import com.streamflixreborn.streamflix.fragments.search.SearchMobileFragment
import com.streamflixreborn.streamflix.fragments.search.SearchMobileFragmentDirections
import com.streamflixreborn.streamflix.fragments.tv_show.TvShowMobileFragment
import com.streamflixreborn.streamflix.fragments.tv_show.TvShowMobileFragmentDirections
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.models.Video
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.ui.ShowOptionsMobileDialog
import com.streamflixreborn.streamflix.ui.SpacingItemDecoration
import com.streamflixreborn.streamflix.utils.ArtworkRepair
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.dp
import com.streamflixreborn.streamflix.utils.format
import com.streamflixreborn.streamflix.utils.getCurrentFragment
import com.streamflixreborn.streamflix.utils.loadMovieBanner
import com.streamflixreborn.streamflix.utils.loadMoviePoster
import com.streamflixreborn.streamflix.utils.toActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

class MovieViewHolder(
    private val _binding: ViewBinding
) : RecyclerView.ViewHolder(
    _binding.root
) {

    private val context = itemView.context
    private val database: AppDatabase
        get() = AppDatabase.getInstance(context)
    private lateinit var movie: Movie
    private val TAG = "TrailerChoiceDebug"

    companion object {
        private const val KEY_PREFERRED_PLAYER = "preferred_player"
        private const val KEY_SMARTTUBE_PACKAGE = "preferred_smarttube_package"
        private const val PLAYER_YOUTUBE = "youtube"
        private const val PLAYER_SMARTTUBE = "smarttube"
        private const val PLAYER_SMARTTUBE_STABLE = "smarttube_stable"
        private const val PLAYER_SMARTTUBE_BETA = "smarttube_beta"
        private const val PLAYER_ASK = "ask"
        private const val SMARTTUBE_STABLE_PACKAGE = "org.smarttube.stable"
        private const val SMARTTUBE_BETA_PACKAGE = "org.smarttube.beta"
    }

    val childRecyclerView: RecyclerView?
        get() = when (_binding) {
            is ContentMovieCastMobileBinding -> _binding.rvMovieCast
            is ContentMovieRecommendationsMobileBinding -> _binding.rvMovieRecommendations
            else -> null
        }

    fun bind(movie: Movie) {
        this.movie = movie

        when (_binding) {
            is ItemMovieMobileBinding -> displayMobileItem(_binding)
            is ItemMovieGridMobileBinding -> displayGridMobileItem(_binding)
            is ItemCategorySwiperMobileBinding -> displaySwiperMobileItem(_binding)

            is ContentMovieMobileBinding -> displayMovieMobile(_binding)
            is ContentMovieDirectorsMobileBinding -> displayDirectorsMobile(_binding)
            is ContentMovieCastMobileBinding -> displayCastMobile(_binding)
            is ContentMovieRecommendationsMobileBinding -> displayRecommendationsMobile(_binding)
        }
    }

    private fun checkProviderAndRun(action: () -> Unit) {
        if (!movie.providerName.isNullOrBlank() && movie.providerName != UserPreferences.currentProvider?.name) {
            Provider.findByName(movie.providerName!!)?.let {
                UserPreferences.currentProvider = it
            }
        }
        action()
    }

    private fun isPackageInstalled(packageName: String): Boolean {
        return try {
            context.packageManager.getPackageInfo(packageName, 0)
            true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun getInstalledSmartTubePackages(): List<String> {
        val installed = mutableListOf<String>()
        if (isPackageInstalled(SMARTTUBE_STABLE_PACKAGE)) installed.add(SMARTTUBE_STABLE_PACKAGE)
        if (isPackageInstalled(SMARTTUBE_BETA_PACKAGE)) installed.add(SMARTTUBE_BETA_PACKAGE)
        return installed
    }

    private fun launchSmartTube(packageName: String, trailerUrl: String) {
        val intent = Intent(Intent.ACTION_VIEW, trailerUrl.toUri())
        intent.setPackage(packageName)
        context.startActivity(intent)
    }

    private fun showSmartTubeVersionDialog(packages: List<String>, trailerUrl: String, shouldSavePreference: Boolean) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val editor = prefs.edit()

        val items = packages.map { pkg ->
            if (pkg == SMARTTUBE_STABLE_PACKAGE) context.getString(R.string.smarttube_stable)
            else context.getString(R.string.smarttube_beta)
        }.toTypedArray()

        AlertDialog.Builder(context)
            .setTitle(context.getString(R.string.choose_smarttube_version))
            .setItems(items) { _, which ->
                val selectedPackage = packages[which]
                if (shouldSavePreference) {
                    editor.putString(KEY_SMARTTUBE_PACKAGE, selectedPackage).apply()
                }
                launchSmartTube(selectedPackage, trailerUrl)
            }.show()
    }

    private fun safeLaunchYoutube(intent: Intent) {
        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch YouTube intent", e)
            Toast.makeText(context, context.getString(R.string.player_external_player_error_video), Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleSmartTubeSelection(trailerUrl: String) {
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val savedPackage = prefs.getString(KEY_SMARTTUBE_PACKAGE, null)
        val stPackages = getInstalledSmartTubePackages()

        if (stPackages.isEmpty()) {
            safeLaunchYoutube(Intent(Intent.ACTION_VIEW, trailerUrl.toUri()))
            return
        }
        if (stPackages.size == 1) {
            launchSmartTube(stPackages[0], trailerUrl)
            return
        }
        if (savedPackage != null && stPackages.contains(savedPackage)) {
            launchSmartTube(savedPackage, trailerUrl)
        } else {
            showSmartTubeVersionDialog(stPackages, trailerUrl, true)
        }
    }

    private fun handleTrailerClick(trailer: String) {
        val youtubeIntent = Intent(Intent.ACTION_VIEW, trailer.toUri())
        val prefs = PreferenceManager.getDefaultSharedPreferences(context)
        val preferredPlayer = prefs.getString(KEY_PREFERRED_PLAYER, PLAYER_ASK)

        when (preferredPlayer) {
            PLAYER_SMARTTUBE -> handleSmartTubeSelection(trailer)
            PLAYER_SMARTTUBE_STABLE -> launchSmartTube(SMARTTUBE_STABLE_PACKAGE, trailer)
            PLAYER_SMARTTUBE_BETA -> launchSmartTube(SMARTTUBE_BETA_PACKAGE, trailer)
            PLAYER_YOUTUBE -> safeLaunchYoutube(youtubeIntent)
            else -> {
                val stPackages = getInstalledSmartTubePackages()
                if (stPackages.isNotEmpty()) {
                    AlertDialog.Builder(context)
                        .setTitle(context.getString(R.string.watch_trailer_with))
                        .setItems(arrayOf(context.getString(R.string.youtube), context.getString(R.string.smarttube))) { _, which ->
                            if (which == 0) {
                                safeLaunchYoutube(youtubeIntent)
                            } else if (stPackages.size > 1) {
                                showSmartTubeVersionDialog(stPackages, trailer, false)
                            } else {
                                launchSmartTube(stPackages[0], trailer)
                            }
                        }.show()
                } else {
                    safeLaunchYoutube(youtubeIntent)
                }
            }
        }
    }

    private fun displayMobileItem(binding: ItemMovieMobileBinding) {
        binding.root.apply {
            setOnClickListener {
                checkProviderAndRun {
                    when (context.toActivity()?.getCurrentFragment()) {
                        is HomeMobileFragment -> {
                            findNavController().navigate(HomeMobileFragmentDirections.actionHomeToMovie(id = movie.id))
                            if (movie.itemType == AppAdapter.Type.MOVIE_CONTINUE_WATCHING_MOBILE_ITEM) {
                                findNavController().navigate(
                                    MovieMobileFragmentDirections.actionMovieToPlayer(
                                        id = movie.id,
                                        title = movie.title,
                                        subtitle = movie.released?.format("yyyy") ?: "",
                                        videoType = Video.Type.Movie(
                                            id = movie.id,
                                            title = movie.title,
                                            releaseDate = movie.released?.format("yyyy-MM-dd") ?: "",
                                            poster = movie.poster ?: "",
                                            imdbId = movie.imdbId,
                                        ),
                                    )
                                )
                            }
                        }
                        is MovieMobileFragment -> findNavController().navigate(MovieMobileFragmentDirections.actionMovieToMovie(id = movie.id))
                        is TvShowMobileFragment -> findNavController().navigate(TvShowMobileFragmentDirections.actionTvShowToMovie(id = movie.id))
                    }
                }
            }
            setOnLongClickListener {
                ShowOptionsMobileDialog(context, movie).show()
                true
            }
        }

        binding.ivMoviePoster.loadMoviePoster(movie) {
            centerCrop()
            transition(DrawableTransitionOptions.withCrossFade())
        }

        binding.tvMovieQuality.apply {
            text = movie.quality ?: ""
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvMovieReleasedYear.text = movie.released?.format("yyyy")
            ?: context.getString(R.string.movie_item_type)

        binding.pbMovieProgress.apply {
            val watchHistory = movie.watchHistory
            progress = when {
                watchHistory != null && watchHistory.durationMillis > 0 ->
                    (watchHistory.lastPlaybackPositionMillis * 100 / watchHistory.durationMillis.toDouble()).toInt()
                else -> 0
            }
            visibility = if (watchHistory != null) View.VISIBLE else View.GONE
        }

        binding.tvMovieTitle.text = movie.title
    }

    private fun displayGridMobileItem(binding: ItemMovieGridMobileBinding) {
        binding.root.apply {
            setOnClickListener {
                checkProviderAndRun {
                    when (context.toActivity()?.getCurrentFragment()) {
                        is GenreMobileFragment -> findNavController().navigate(GenreMobileFragmentDirections.actionGenreToMovie(id = movie.id))
                        is MoviesMobileFragment -> findNavController().navigate(MoviesMobileFragmentDirections.actionMoviesToMovie(id = movie.id))
                        is PeopleMobileFragment -> findNavController().navigate(PeopleMobileFragmentDirections.actionPeopleToMovie(id = movie.id))
                        is SearchMobileFragment -> findNavController().navigate(SearchMobileFragmentDirections.actionSearchToMovie(id = movie.id))
                    }
                }
            }
            setOnLongClickListener {
                ShowOptionsMobileDialog(context, movie).show()
                true
            }
        }

        binding.ivMoviePoster.loadMoviePoster(movie) {
            centerCrop()
            transition(DrawableTransitionOptions.withCrossFade())
        }

        binding.tvMovieQuality.apply {
            text = movie.quality ?: ""
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvMovieReleasedYear.text = movie.released?.format("yyyy")
            ?: context.getString(R.string.movie_item_type)

        binding.pbMovieProgress.apply {
            val watchHistory = movie.watchHistory
            progress = when {
                watchHistory != null && watchHistory.durationMillis > 0 ->
                    (watchHistory.lastPlaybackPositionMillis * 100 / watchHistory.durationMillis.toDouble()).toInt()
                else -> 0
            }
            visibility = if (watchHistory != null) View.VISIBLE else View.GONE
        }

        binding.tvMovieTitle.text = movie.title
    }

    private fun displaySwiperMobileItem(binding: ItemCategorySwiperMobileBinding) {
        binding.ivSwiperBackground.loadMovieBanner(movie) {
            centerCrop()
            transition(DrawableTransitionOptions.withCrossFade())
        }

        binding.tvSwiperTitle.text = movie.title
        binding.tvSwiperTvShowLastEpisode.text = context.getString(R.string.movie_item_type)

        binding.tvSwiperQuality.apply {
            text = movie.quality
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvSwiperReleased.apply {
            text = movie.released?.format("yyyy")
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvSwiperRating.apply {
            text = movie.rating?.let { String.format(Locale.ROOT, "%.1f", it) } ?: "N/A"
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.ivSwiperRatingIcon.visibility = binding.tvSwiperRating.visibility

        binding.tvSwiperOverview.apply {
            setOnClickListener {
                maxLines = if (maxLines == 2) Int.MAX_VALUE else 2
            }
            text = movie.overview
        }

        binding.btnSwiperWatchNow.setOnClickListener {
            findNavController().navigate(
                HomeMobileFragmentDirections.actionHomeToMovie(id = movie.id)
            )
        }

        binding.pbSwiperProgress.apply {
            val watchHistory = movie.watchHistory
            progress = when {
                watchHistory != null && watchHistory.durationMillis > 0 ->
                    (watchHistory.lastPlaybackPositionMillis * 100 / watchHistory.durationMillis.toDouble()).toInt()
                else -> 0
            }
            visibility = if (watchHistory != null) View.VISIBLE else View.GONE
        }
    }

    private fun displayMovieMobile(binding: ContentMovieMobileBinding) {
        binding.ivMoviePoster.run {
            loadMoviePoster(movie) {
                transition(DrawableTransitionOptions.withCrossFade())
            }
            visibility = if (movie.poster.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvMovieTitle.text = movie.title
        binding.tvMovieRating.text = movie.rating?.let { String.format(Locale.ROOT, "%.1f", it) } ?: "N/A"

        binding.tvMovieQuality.apply {
            text = movie.quality
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvMovieReleased.apply {
            text = movie.released?.format("yyyy")
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvMovieRuntime.apply {
            text = movie.runtime?.let {
                val hours = it / 60
                val minutes = it % 60
                if (hours > 0) {
                    context.getString(R.string.movie_runtime_hours_minutes, hours, minutes)
                } else {
                    context.getString(R.string.movie_runtime_minutes, minutes)
                }
            }
            visibility = if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvMovieGenres.apply {
            text = movie.genres.joinToString(", ") { it.name }
            visibility = if (movie.genres.isEmpty()) View.GONE else View.VISIBLE
        }

        binding.tvMovieOverview.text = movie.overview

        binding.btnMovieWatchNow.setOnClickListener {
            checkProviderAndRun {
                binding.btnMovieWatchNow.findNavController().navigate(
                    MovieMobileFragmentDirections.actionMovieToPlayer(
                        id = movie.id,
                        title = movie.title,
                        subtitle = movie.released?.format("yyyy") ?: "",
                        videoType = Video.Type.Movie(
                            id = movie.id,
                            title = movie.title,
                            releaseDate = movie.released?.format("yyyy-MM-dd") ?: "",
                            poster = movie.poster ?: movie.banner ?: "",
                            imdbId = movie.imdbId,
                        ),
                    )
                )
            }
        }

        binding.pbMovieProgress.apply {
            val watchHistory = movie.watchHistory
            progress = when {
                watchHistory != null && watchHistory.durationMillis > 0 ->
                    (watchHistory.lastPlaybackPositionMillis * 100 / watchHistory.durationMillis.toDouble()).toInt()
                else -> 0
            }
            visibility = if (watchHistory != null) View.VISIBLE else View.GONE
        }

        binding.btnMovieTrailer.apply {
            val trailer = movie.trailer
            setOnClickListener {
                if (trailer != null) handleTrailerClick(trailer)
            }
            visibility = if (trailer != null) View.VISIBLE else View.GONE
        }

        binding.btnMovieFavorite.apply {
            fun Boolean.drawable() = if (this) R.drawable.ic_favorite_enable else R.drawable.ic_favorite_disable

            setOnClickListener {
                checkProviderAndRun {
                    itemView.findViewTreeLifecycleOwner()?.lifecycleScope?.launch(Dispatchers.IO) {
                        val dao = database.movieDao()
                        val current = dao.getById(movie.id)?.isFavorite ?: false
                        val newValue = !current
                        val resolvedMovie = ArtworkRepair.resolveMovieForFavorite(context, movie, newValue)

                        dao.upsertFavorite(resolvedMovie, newValue)

                        withContext(Dispatchers.Main) {
                            movie.poster = resolvedMovie.poster
                            movie.banner = resolvedMovie.banner
                            movie.isFavorite = newValue
                            setImageDrawable(ContextCompat.getDrawable(context, newValue.drawable()))
                        }
                    }
                }
            }

            setImageDrawable(ContextCompat.getDrawable(context, movie.isFavorite.drawable()))
        }
    }

    private fun displayCastMobile(binding: ContentMovieCastMobileBinding) {
        binding.rvMovieCast.apply {
            adapter = AppAdapter().apply {
                submitList(movie.cast.onEach {
                    it.itemType = AppAdapter.Type.PEOPLE_MOBILE_ITEM
                })
            }
            if (itemDecorationCount == 0) {
                addItemDecoration(SpacingItemDecoration(20.dp(context)))
            }
        }
    }

    private fun displayDirectorsMobile(binding: ContentMovieDirectorsMobileBinding) {
        binding.rvMovieDirectors.text = movie.directors.joinToString(separator = ", ") { it.name }
    }

    private fun displayRecommendationsMobile(binding: ContentMovieRecommendationsMobileBinding) {
        binding.rvMovieRecommendations.apply {
            adapter = AppAdapter().apply {
                submitList(movie.recommendations.onEach {
                    when (it) {
                        is Movie -> it.itemType = AppAdapter.Type.MOVIE_MOBILE_ITEM
                        is TvShow -> it.itemType = AppAdapter.Type.TV_SHOW_MOBILE_ITEM
                    }
                })
            }
            if (itemDecorationCount == 0) {
                addItemDecoration(SpacingItemDecoration(10.dp(context)))
            }
        }
    }
}
