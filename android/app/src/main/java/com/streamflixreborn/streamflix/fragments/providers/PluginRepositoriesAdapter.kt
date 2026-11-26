package com.streamflixreborn.streamflix.fragments.providers

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.databinding.ItemPluginRepositoryMobileBinding
import com.streamflixreborn.streamflix.databinding.ItemPluginScraperRowMobileBinding
import com.streamflixreborn.streamflix.plugins.InstalledScraper
import com.streamflixreborn.streamflix.plugins.PluginRepository

class PluginRepositoriesAdapter(
    private val onToggleRepository: (PluginRepository, Boolean) -> Unit,
    private val onRefreshRepository: (PluginRepository) -> Unit,
    private val onDeleteRepository: (PluginRepository) -> Unit,
    private val onToggleScraper: (InstalledScraper, Boolean) -> Unit,
) : ListAdapter<RepositoryWithScrapers, PluginRepositoriesAdapter.ViewHolder>(DiffCallback) {

    object DiffCallback : DiffUtil.ItemCallback<RepositoryWithScrapers>() {
        override fun areItemsTheSame(
            oldItem: RepositoryWithScrapers,
            newItem: RepositoryWithScrapers,
        ): Boolean = oldItem.repository.id == newItem.repository.id

        override fun areContentsTheSame(
            oldItem: RepositoryWithScrapers,
            newItem: RepositoryWithScrapers,
        ): Boolean = oldItem == newItem
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemPluginRepositoryMobileBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    inner class ViewHolder(
        private val binding: ItemPluginRepositoryMobileBinding,
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(item: RepositoryWithScrapers) {
            val context = binding.root.context
            val repo = item.repository

            binding.tvRepoName.text = repo.name
            binding.tvRepoVersion.text = "v${repo.version.removePrefix("v")}"
            binding.tvRepoUrl.text = repo.manifestUrl

            binding.swRepoEnabled.setOnCheckedChangeListener(null)
            binding.swRepoEnabled.isChecked = repo.enabled
            binding.swRepoEnabled.setOnCheckedChangeListener { _, isChecked ->
                onToggleRepository(repo, isChecked)
            }

            binding.btnRepoRefresh.setOnClickListener {
                onRefreshRepository(repo)
            }

            binding.btnRepoDelete.setOnClickListener {
                onDeleteRepository(repo)
            }

            binding.vRepoDivider.visibility = if (item.scrapers.isEmpty()) View.GONE else View.VISIBLE
            binding.llRepoScrapers.removeAllViews()

            val inflater = LayoutInflater.from(context)
            item.scrapers.forEach { scraper ->
                val rowBinding = ItemPluginScraperRowMobileBinding.inflate(
                    inflater,
                    binding.llRepoScrapers,
                    false
                )

                rowBinding.tvScraperName.text = scraper.name
                rowBinding.tvScraperName.alpha = if (repo.enabled && scraper.enabled) 1.0f else 0.55f

                val typeLabels = buildList {
                    if (scraper.supportsMediaType("movie")) {
                        add(context.getString(R.string.plugins_type_movies))
                    }
                    if (scraper.supportsMediaType("tv")) {
                        add(context.getString(R.string.plugins_type_series))
                    }
                }
                val metaParts = mutableListOf<String>()
                if (typeLabels.isNotEmpty()) {
                    metaParts.add(typeLabels.joinToString(" • "))
                }
                if (scraper.contentLanguage.isNotEmpty()) {
                    metaParts.add(scraper.contentLanguage.joinToString(", ").uppercase())
                }
                metaParts.add("v${scraper.version.removePrefix("v")}")
                rowBinding.tvScraperMeta.text = metaParts.joinToString("  •  ")

                val logoUrl = scraper.logo?.takeIf { it.isNotBlank() }
                if (logoUrl != null) {
                    Glide.with(context)
                        .load(logoUrl)
                        .placeholder(R.drawable.ic_player_settings_servers)
                        .error(R.drawable.ic_player_settings_servers)
                        .fitCenter()
                        .into(rowBinding.ivScraperLogo)
                } else {
                    rowBinding.ivScraperLogo.setImageResource(R.drawable.ic_player_settings_servers)
                }

                rowBinding.swScraperEnabled.setOnCheckedChangeListener(null)
                rowBinding.swScraperEnabled.isEnabled = repo.enabled
                rowBinding.swScraperEnabled.isChecked = scraper.enabled
                rowBinding.swScraperEnabled.setOnCheckedChangeListener { _, isChecked ->
                    onToggleScraper(scraper, isChecked)
                }

                binding.llRepoScrapers.addView(rowBinding.root)
            }
        }
    }
}
