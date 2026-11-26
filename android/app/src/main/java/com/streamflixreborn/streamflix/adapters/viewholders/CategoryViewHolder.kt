package com.streamflixreborn.streamflix.adapters.viewholders

import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.LinearLayout
import androidx.core.os.postDelayed
import androidx.core.view.children
import androidx.recyclerview.widget.RecyclerView
import androidx.viewbinding.ViewBinding
import androidx.viewpager2.widget.ViewPager2
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.adapters.AppAdapter
import com.streamflixreborn.streamflix.databinding.ContentCategorySwiperMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemCategoryMobileBinding
import com.streamflixreborn.streamflix.models.Category
import com.streamflixreborn.streamflix.models.Movie
import com.streamflixreborn.streamflix.models.TvShow
import com.streamflixreborn.streamflix.ui.SpacingItemDecoration

class CategoryViewHolder(
    private val _binding: ViewBinding
) : RecyclerView.ViewHolder(
    _binding.root
) {

    private val context = itemView.context
    private lateinit var category: Category

    val childRecyclerView: RecyclerView?
        get() = when (_binding) {
            is ItemCategoryMobileBinding -> _binding.rvCategory
            is ContentCategorySwiperMobileBinding -> _binding.vpCategorySwiper.javaClass
                .getDeclaredField("mRecyclerView").let {
                    it.isAccessible = true
                    it.get(_binding.vpCategorySwiper) as RecyclerView
                }
            else -> null
        }

    fun bind(
        category: Category,
        onMovieClick: ((Movie) -> Unit)? = null,
        onTvShowClick: ((TvShow) -> Unit)? = null
    ) {
        this.category = category

        when (_binding) {
            is ItemCategoryMobileBinding -> displayMobileItem(_binding, onMovieClick, onTvShowClick)
            is ContentCategorySwiperMobileBinding -> displayMobileSwiper(_binding, onMovieClick, onTvShowClick)
        }
    }

    private fun displayMobileItem(
        binding: ItemCategoryMobileBinding,
        onMovieClick: ((Movie) -> Unit)?,
        onTvShowClick: ((TvShow) -> Unit)?
    ) {
        binding.tvCategoryTitle.text = category.name

        binding.rvCategory.apply {
            val categoryAdapter = (adapter as? AppAdapter) ?: AppAdapter().also { adapter = it }
            categoryAdapter.apply {
                this.onMovieClickListener = onMovieClick
                this.onTvShowClickListener = onTvShowClick
                submitList(category.list)
            }
            if (itemDecorationCount == 0) {
                addItemDecoration(SpacingItemDecoration(category.itemSpacing))
            }
        }
    }

    private fun displayMobileSwiper(
        binding: ContentCategorySwiperMobileBinding,
        onMovieClick: ((Movie) -> Unit)?,
        onTvShowClick: ((TvShow) -> Unit)?
    ) {
        binding.tvCategoryTitle.text = category.name
        val handler = Handler(Looper.getMainLooper())
        handler.postDelayed(8_000) {
            binding.vpCategorySwiper.currentItem += 1
        }

        val items = listOf(
            listOfNotNull(category.list.lastOrNull()),
            category.list,
            listOfNotNull(category.list.firstOrNull()),
        ).flatten()
        binding.vpCategorySwiper.apply {
            adapter = AppAdapter().apply {
                this.onMovieClickListener = onMovieClick
                this.onTvShowClickListener = onTvShowClick
                submitList(category.list)
                post { (adapter as AppAdapter).submitList(items) }
            }
        }

        binding.llDotsIndicator.apply {
            removeAllViews()
            repeat(category.list.size) {
                val view = View(context).apply {
                    layoutParams = LinearLayout.LayoutParams(15, 15).apply {
                        setMargins(10, 0, 10, 0)
                    }
                    setBackgroundResource(R.drawable.bg_dot_indicator)
                }
                addView(view)
            }
        }

        binding.vpCategorySwiper.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                val indicatorPosition = when (position) {
                    0 -> category.list.lastIndex
                    items.lastIndex -> 0
                    else -> position - 1
                }
                binding.llDotsIndicator.children.forEachIndexed { index, view ->
                    view.isSelected = (indicatorPosition == index)
                }

                handler.removeCallbacksAndMessages(null)
                handler.postDelayed(8_000) {
                    binding.vpCategorySwiper.currentItem += 1
                }
            }

            override fun onPageScrollStateChanged(state: Int) {
                if (state == ViewPager2.SCROLL_STATE_IDLE) {
                    when (binding.vpCategorySwiper.currentItem) {
                        0 -> binding.vpCategorySwiper.setCurrentItem(
                            items.lastIndex - 1,
                            false
                        )
                        items.lastIndex -> binding.vpCategorySwiper.setCurrentItem(
                            1,
                            false
                        )
                    }
                }
            }
        })
    }
}
