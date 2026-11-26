package com.streamflixreborn.streamflix.adapters

import android.os.Parcelable
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.RecyclerView
import androidx.viewbinding.ViewBinding
import com.streamflixreborn.streamflix.adapters.viewholders.CategoryViewHolder
import com.streamflixreborn.streamflix.adapters.viewholders.EpisodeViewHolder
import com.streamflixreborn.streamflix.adapters.viewholders.GenreViewHolder
import com.streamflixreborn.streamflix.adapters.viewholders.MovieViewHolder
import com.streamflixreborn.streamflix.adapters.viewholders.PeopleViewHolder
import com.streamflixreborn.streamflix.adapters.viewholders.SeasonViewHolder
import com.streamflixreborn.streamflix.adapters.viewholders.TvShowViewHolder
import com.streamflixreborn.streamflix.databinding.ContentCategorySwiperMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentMovieCastMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentMovieDirectorsMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentMovieMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentMovieRecommendationsMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentTvShowCastMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentTvShowDirectorsMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentTvShowMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentTvShowRecommendationsMobileBinding
import com.streamflixreborn.streamflix.databinding.ContentTvShowSeasonsMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemCategoryMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemCategorySwiperMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemEpisodeContinueWatchingMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemEpisodeMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemGenreGridMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemLoadingBinding
import com.streamflixreborn.streamflix.databinding.ItemMovieGridMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemMovieMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemPeopleMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemSeasonMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemTvShowGridMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemTvShowMobileBinding
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.Episode
import com.streamflixreborn.streamflix.models.Genre
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.People
import com.streamflixreborn.streamflix.models.Season
import com.streamflixreborn.streamflix.models.TvShow

class AppAdapter(
    val items: MutableList<Item> = mutableListOf()
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    init {
        setHasStableIds(true)
    }

    var onMovieClickListener: ((Movie) -> Unit)? = null
    var onTvShowClickListener: ((TvShow) -> Unit)? = null
    var onMovieLongClickListener: ((Movie) -> Unit)? = null
    var onTvShowLongClickListener: ((TvShow) -> Unit)? = null
    var onGenreClickListener: ((Genre) -> Unit)? = null
    var onPeopleClickListener: ((People) -> Unit)? = null
    var onEpisodeClickListener: ((Episode) -> Unit)? = null
    var onSeasonClickListener: ((Season) -> Unit)? = null

    interface Item {
        var itemType: Type
    }

    enum class Type {
        CATEGORY_MOBILE_ITEM,
        CATEGORY_MOBILE_SWIPER,

        EPISODE_MOBILE_ITEM,
        EPISODE_CONTINUE_WATCHING_MOBILE_ITEM,

        FOOTER,

        GENRE_GRID_MOBILE_ITEM,

        HEADER,

        LOADING_ITEM,

        MOVIE_MOBILE_ITEM,
        MOVIE_CONTINUE_WATCHING_MOBILE_ITEM,
        MOVIE_GRID_MOBILE_ITEM,
        MOVIE_SWIPER_MOBILE_ITEM,

        MOVIE_MOBILE,
        MOVIE_DIRECTORS_MOBILE,
        MOVIE_CAST_MOBILE,
        MOVIE_RECOMMENDATIONS_MOBILE,

        PEOPLE_MOBILE_ITEM,

        SEASON_MOBILE_ITEM,

        TV_SHOW_MOBILE_ITEM,
        TV_SHOW_GRID_MOBILE_ITEM,
        TV_SHOW_SWIPER_MOBILE_ITEM,

        TV_SHOW_MOBILE,
        TV_SHOW_SEASONS_MOBILE,
        TV_SHOW_DIRECTORS_MOBILE,
        TV_SHOW_CAST_MOBILE,
        TV_SHOW_RECOMMENDATIONS_MOBILE,
    }

    private val states = mutableMapOf<Int, Parcelable?>()

    var isLoading = false
    private var header: Header<ViewBinding>? = null
    private var onLoadMoreListener: (() -> Unit)? = null
    private var footer: Footer<ViewBinding>? = null

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
        when (Type.entries[viewType]) {
            Type.CATEGORY_MOBILE_ITEM -> CategoryViewHolder(
                ItemCategoryMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.CATEGORY_MOBILE_SWIPER -> CategoryViewHolder(
                ContentCategorySwiperMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.EPISODE_MOBILE_ITEM -> EpisodeViewHolder(
                ItemEpisodeMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.EPISODE_CONTINUE_WATCHING_MOBILE_ITEM -> EpisodeViewHolder(
                ItemEpisodeContinueWatchingMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.FOOTER -> FooterViewHolder(
                footer!!.binding(parent)
            )
            Type.GENRE_GRID_MOBILE_ITEM -> GenreViewHolder(
                ItemGenreGridMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.HEADER -> HeaderViewHolder(
                header!!.binding(parent)
            )
            Type.LOADING_ITEM -> LoadingViewHolder(
                ItemLoadingBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.MOVIE_CONTINUE_WATCHING_MOBILE_ITEM,
            Type.MOVIE_MOBILE_ITEM -> MovieViewHolder(
                ItemMovieMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.MOVIE_GRID_MOBILE_ITEM -> MovieViewHolder(
                ItemMovieGridMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.MOVIE_SWIPER_MOBILE_ITEM -> MovieViewHolder(
                ItemCategorySwiperMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.MOVIE_MOBILE -> MovieViewHolder(
                ContentMovieMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.MOVIE_DIRECTORS_MOBILE -> MovieViewHolder(
                ContentMovieDirectorsMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.MOVIE_CAST_MOBILE -> MovieViewHolder(
                ContentMovieCastMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.MOVIE_RECOMMENDATIONS_MOBILE -> MovieViewHolder(
                ContentMovieRecommendationsMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.PEOPLE_MOBILE_ITEM -> PeopleViewHolder(
                ItemPeopleMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.SEASON_MOBILE_ITEM -> SeasonViewHolder(
                ItemSeasonMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_MOBILE_ITEM -> TvShowViewHolder(
                ItemTvShowMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_GRID_MOBILE_ITEM -> TvShowViewHolder(
                ItemTvShowGridMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_SWIPER_MOBILE_ITEM -> TvShowViewHolder(
                ItemCategorySwiperMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_MOBILE -> TvShowViewHolder(
                ContentTvShowMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_SEASONS_MOBILE -> TvShowViewHolder(
                ContentTvShowSeasonsMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_DIRECTORS_MOBILE -> TvShowViewHolder(
                ContentTvShowDirectorsMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_CAST_MOBILE -> TvShowViewHolder(
                ContentTvShowCastMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
            Type.TV_SHOW_RECOMMENDATIONS_MOBILE -> TvShowViewHolder(
                ContentTvShowRecommendationsMobileBinding.inflate(
                    LayoutInflater.from(parent.context),
                    parent,
                    false,
                )
            )
        }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        if (position >= itemCount - 5 && !isLoading) {
            onLoadMoreListener?.invoke()
            isLoading = true
        }

        val adjustedPosition = header?.let { position - 1 } ?: position
        when (holder) {
            is CategoryViewHolder -> holder.bind(
                items[adjustedPosition] as Category,
                onMovieClickListener,
                onTvShowClickListener,
            )
            is EpisodeViewHolder -> holder.bind(
                items[adjustedPosition] as Episode
            )
            is FooterViewHolder -> footer?.bind?.invoke(holder.binding)
            is GenreViewHolder -> holder.bind(
                items[adjustedPosition] as Genre
            )
            is HeaderViewHolder -> header?.bind?.invoke(holder.binding)
            is MovieViewHolder -> holder.bind(
                items[adjustedPosition] as Movie
            )
            is PeopleViewHolder -> holder.bind(
                items[adjustedPosition] as People
            )
            is SeasonViewHolder -> holder.bind(
                items[adjustedPosition] as Season
            )
            is TvShowViewHolder -> holder.bind(
                items[adjustedPosition] as TvShow
            )
        }

        val state = states[holder.layoutPosition]
        if (state != null) {
            when (holder) {
                is CategoryViewHolder -> holder.childRecyclerView?.layoutManager?.onRestoreInstanceState(state)
                is MovieViewHolder -> holder.childRecyclerView?.layoutManager?.onRestoreInstanceState(state)
                is TvShowViewHolder -> holder.childRecyclerView?.layoutManager?.onRestoreInstanceState(state)
            }
        }
    }

    override fun getItemCount(): Int = items.size +
        (header?.let { 1 } ?: 0) +
        (onLoadMoreListener?.let { 1 } ?: 0) +
        (footer?.let { 1 } ?: 0)

    override fun getItemId(position: Int): Long {
        if (header != null && position == 0) return Long.MIN_VALUE

        val adjustedPosition = header?.let { position - 1 } ?: position
        if (adjustedPosition in items.indices) {
            return items.stableIdAt(adjustedPosition)
        }

        val loadMorePosition = itemCount - 1 - (if (footer != null) 1 else 0)
        if (onLoadMoreListener != null && position == loadMorePosition) {
            return Long.MIN_VALUE + 1
        }

        if (footer != null && position == itemCount - 1) {
            return Long.MIN_VALUE + 2
        }

        return RecyclerView.NO_ID
    }

    override fun getItemViewType(position: Int): Int {
        if (header != null && position == 0) {
            return Type.HEADER.ordinal
        }

        val adjustedPosition = header?.let { position - 1 } ?: position
        if (adjustedPosition in items.indices) {
            return items[adjustedPosition].itemType.ordinal
        }

        val loadMorePosition = itemCount - 1 - (if (footer != null) 1 else 0)
        if (onLoadMoreListener != null && position == loadMorePosition) {
            return Type.LOADING_ITEM.ordinal
        }

        if (footer != null && position == itemCount - 1) {
            return Type.FOOTER.ordinal
        }

        return Type.LOADING_ITEM.ordinal
    }

    override fun onViewRecycled(holder: RecyclerView.ViewHolder) {
        super.onViewRecycled(holder)

        states[holder.layoutPosition] = when (holder) {
            is CategoryViewHolder -> holder.childRecyclerView?.layoutManager?.onSaveInstanceState()
            is MovieViewHolder -> holder.childRecyclerView?.layoutManager?.onSaveInstanceState()
            is TvShowViewHolder -> holder.childRecyclerView?.layoutManager?.onSaveInstanceState()
            else -> null
        }
    }

    fun onSaveInstanceState(recyclerView: RecyclerView) {
        for (position in items.indices) {
            val holder = recyclerView.findViewHolderForAdapterPosition(position) ?: continue

            states[position] = when (holder) {
                is CategoryViewHolder -> holder.childRecyclerView?.layoutManager?.onSaveInstanceState()
                is MovieViewHolder -> holder.childRecyclerView?.layoutManager?.onSaveInstanceState()
                is TvShowViewHolder -> holder.childRecyclerView?.layoutManager?.onSaveInstanceState()
                else -> null
            }
        }
    }

    fun submitList(list: List<Item>) {
        val result = DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = items.size

            override fun getNewListSize() = list.size

            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
                val oldItem = items[oldItemPosition]
                val newItem = list[newItemPosition]
                return items.identityAt(oldItemPosition) == list.identityAt(newItemPosition) &&
                    oldItem::class == newItem::class
            }

            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean {
                val oldItem = items[oldItemPosition]
                val newItem = list[newItemPosition]
                return oldItem == newItem
            }
        })

        if (items.size < list.size) {
            for (newItemPosition in list.indices.reversed()) {
                val oldItemPosition = result.convertNewPositionToOld(newItemPosition)
                    .takeIf { it != -1 } ?: continue

                states[newItemPosition] = states[oldItemPosition]
            }
        } else if (items.size > list.size) {
            for (oldItemPosition in items.indices) {
                val newItemPosition = result.convertOldPositionToNew(oldItemPosition)
                    .takeIf { it != -1 } ?: continue

                states[newItemPosition] = states[oldItemPosition]
            }
        }

        items.clear()
        items.addAll(list)
        result.dispatchUpdatesTo(this)
    }

    fun <T : ViewBinding> setHeader(
        binding: (parent: ViewGroup) -> T,
        bind: ((binding: T) -> Unit)? = null,
    ) {
        @Suppress("UNCHECKED_CAST")
        this.header = Header(
            binding = binding,
            bind = bind as ((ViewBinding) -> Unit)?,
        )
    }

    fun setOnLoadMoreListener(onLoadMoreListener: (() -> Unit)?) {
        if (this.onLoadMoreListener != null && onLoadMoreListener == null) {
            this.onLoadMoreListener = null
            notifyItemRemoved(items.size)
        } else {
            this.onLoadMoreListener = onLoadMoreListener
        }
    }

    fun <T : ViewBinding> setFooter(
        binding: (parent: ViewGroup) -> T,
        bind: ((binding: T) -> Unit)? = null,
    ) {
        @Suppress("UNCHECKED_CAST")
        this.footer = Footer(
            binding = binding,
            bind = bind as ((ViewBinding) -> Unit)?,
        )
    }

    private class HeaderViewHolder(
        val binding: ViewBinding
    ) : RecyclerView.ViewHolder(
        binding.root
    )

    private data class Header<T : ViewBinding>(
        val binding: (parent: ViewGroup) -> T,
        val bind: ((binding: T) -> Unit)? = null,
    )

    private class LoadingViewHolder(
        binding: ViewBinding
    ) : RecyclerView.ViewHolder(
        binding.root
    )

    private class FooterViewHolder(
        val binding: ViewBinding
    ) : RecyclerView.ViewHolder(
        binding.root
    )

    private data class Footer<T : ViewBinding>(
        val binding: (parent: ViewGroup) -> T,
        val bind: ((binding: T) -> Unit)? = null,
    )

    private fun List<Item>.stableIdAt(position: Int): Long {
        return identityAt(position).fold(1125899906842597L) { acc, char ->
            31L * acc + char.code
        }
    }

    private fun List<Item>.identityAt(position: Int): String {
        val item = this[position]
        val baseKey = item.baseIdentityKey()
        val occurrenceIndex = subList(0, position).count {
            it.itemType == item.itemType && it.baseIdentityKey() == baseKey
        }
        return "${item.itemType.ordinal}:$baseKey:$occurrenceIndex"
    }

    private fun Item.baseIdentityKey(): String = when (this) {
        is Category -> "category:${name}"
        is Episode -> "episode:${id}"
        is Genre -> "genre:${id}"
        is Movie -> "movie:${id}"
        is People -> "people:${id}"
        is Season -> "season:${id}"
        is TvShow -> "tvshow:${id}"
        else -> "item:${itemType.name}"
    }
}
