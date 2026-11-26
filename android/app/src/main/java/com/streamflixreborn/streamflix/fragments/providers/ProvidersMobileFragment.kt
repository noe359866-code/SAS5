package com.streamflixreborn.streamflix.fragments.providers

import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.fragment.app.Fragment
import androidx.fragment.app.viewModels
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.flowWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavOptions
import androidx.navigation.fragment.findNavController
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.databinding.FragmentProvidersMobileBinding
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.providers.TmdbProvider
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.hideKeyboard
import kotlinx.coroutines.launch
import java.util.Locale

class ProvidersMobileFragment : Fragment() {

    private var _binding: FragmentProvidersMobileBinding? = null
    private val binding get() = _binding!!

    private val viewModel by viewModels<ProvidersViewModel>()

    private lateinit var repositoriesAdapter: PluginRepositoriesAdapter

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentProvidersMobileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        setupCatalogLanguageSpinner()
        setupInstallControls()
        setupRepositoriesList()
        observeViewModel()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun setupCatalogLanguageSpinner() {
        data class CatalogLangOption(val code: String, val label: String)

        val languages = Provider.providers.keys
            .filterIsInstance<TmdbProvider>()
            .map { provider ->
                val locale = Locale.forLanguageTag(provider.language)
                val display = locale.getDisplayLanguage(locale)
                    .replaceFirstChar { ch -> ch.titlecase(locale) }
                CatalogLangOption(code = provider.language, label = "$display (${provider.language.uppercase()})")
            }
            .distinctBy { it.code }

        if (languages.isEmpty()) return

        val spinnerAdapter = ArrayAdapter(
            binding.sCatalogLanguage.context,
            android.R.layout.simple_spinner_item,
            languages.map { it.label }.toTypedArray()
        ).also {
            it.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        }
        binding.sCatalogLanguage.adapter = spinnerAdapter

        val currentCode = (UserPreferences.currentProvider as? TmdbProvider)?.language
            ?: UserPreferences.providerLanguage
            ?: Provider.defaultCatalogProvider(requireContext()).language
        val initialIndex = languages.indexOfFirst { it.code == currentCode }.coerceAtLeast(0)
        binding.sCatalogLanguage.setSelection(initialIndex, false)

        binding.sCatalogLanguage.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                val chosen = languages.getOrNull(position) ?: return
                viewModel.selectCatalogLanguage(chosen.code)
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }

    private fun setupInstallControls() {
        binding.btnContinueToCatalog.setOnClickListener {
            openCatalog()
        }

        binding.btnPasteManifestUrl.setOnClickListener {
            val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            val pasted = clipboard?.primaryClip
                ?.takeIf { it.itemCount > 0 }
                ?.getItemAt(0)
                ?.coerceToText(requireContext())
                ?.toString()
                ?.trim()
                .orEmpty()

            if (pasted.isEmpty()) {
                Toast.makeText(
                    requireContext(),
                    getString(R.string.plugins_clipboard_empty),
                    Toast.LENGTH_SHORT
                ).show()
            } else {
                binding.etManifestUrl.setText(pasted)
                binding.etManifestUrl.setSelection(pasted.length)
            }
        }

        val submitManifest = {
            val rawUrl = binding.etManifestUrl.text?.toString()?.trim().orEmpty()
            if (rawUrl.isEmpty()) {
                Toast.makeText(
                    requireContext(),
                    getString(R.string.plugins_manifest_url_empty),
                    Toast.LENGTH_SHORT
                ).show()
            } else {
                hideKeyboard()
                viewModel.installRepository(rawUrl)
            }
        }

        binding.btnInstallManifest.setOnClickListener { submitManifest() }
        binding.etManifestUrl.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submitManifest()
                true
            } else {
                false
            }
        }

        binding.btnRefreshAllRepos.setOnClickListener {
            viewModel.refreshAllRepositories()
        }
    }

    private fun setupRepositoriesList() {
        repositoriesAdapter = PluginRepositoriesAdapter(
            onToggleRepository = { repo, enabled ->
                viewModel.setRepositoryEnabled(repo.id, enabled)
            },
            onRefreshRepository = { repo ->
                viewModel.refreshRepository(repo)
            },
            onDeleteRepository = { repo ->
                AlertDialog.Builder(requireContext())
                    .setTitle(getString(R.string.plugins_remove_confirm_title))
                    .setMessage(getString(R.string.plugins_remove_confirm_message, repo.name))
                    .setPositiveButton(getString(R.string.plugins_remove_repo)) { _, _ ->
                        viewModel.removeRepository(repo)
                    }
                    .setNegativeButton(android.R.string.cancel, null)
                    .show()
            },
            onToggleScraper = { scraper, enabled ->
                viewModel.setScraperEnabled(scraper.uniqueKey, enabled)
            }
        )

        binding.rvPluginRepositories.adapter = repositoriesAdapter
    }

    private fun observeViewModel() {
        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.isBusy.flowWithLifecycle(lifecycle, Lifecycle.State.STARTED).collect { busy ->
                binding.pbPluginsBusy.visibility = if (busy) View.VISIBLE else View.GONE
                binding.btnInstallManifest.isEnabled = !busy
                binding.btnInstallManifest.alpha = if (busy) 0.6f else 1.0f
                binding.btnRefreshAllRepos.isEnabled = !busy
                binding.btnRefreshAllRepos.alpha = if (busy) 0.6f else 1.0f
            }
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.repositoryItems.flowWithLifecycle(lifecycle, Lifecycle.State.STARTED).collect { items ->
                repositoriesAdapter.submitList(items)

                val repoCount = items.size
                val totalScrapers = items.sumOf { it.scrapers.size }
                val activeScrapers = items.sumOf { entry ->
                    if (!entry.repository.enabled) 0 else entry.scrapers.count { it.enabled }
                }

                binding.llPluginsEmpty.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
                binding.rvPluginRepositories.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
                binding.btnRefreshAllRepos.visibility = if (items.isEmpty()) View.GONE else View.VISIBLE
                binding.tvPluginsStats.text = getString(
                    R.string.plugins_stats_summary,
                    repoCount,
                    activeScrapers,
                    totalScrapers
                )
            }
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewModel.events.flowWithLifecycle(lifecycle, Lifecycle.State.STARTED).collect { event ->
                val message = when (event) {
                    is ProvidersViewModel.UiEvent.Installed -> {
                        binding.etManifestUrl.text?.clear()
                        getString(R.string.plugins_installed_toast, event.repositoryName, event.scraperCount)
                    }
                    is ProvidersViewModel.UiEvent.Refreshed ->
                        getString(R.string.plugins_refreshed_toast, event.repositoryName)
                    is ProvidersViewModel.UiEvent.RefreshedAll ->
                        getString(R.string.plugins_refreshed_all_toast, event.updatedCount)
                    is ProvidersViewModel.UiEvent.Removed ->
                        getString(R.string.plugins_removed_toast, event.repositoryName)
                    is ProvidersViewModel.UiEvent.Error -> event.message
                }
                Toast.makeText(requireContext(), message, Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun openCatalog() {
        if (UserPreferences.currentProvider == null) {
            UserPreferences.currentProvider = Provider.defaultCatalogProvider(requireContext())
        }
        UserPreferences.pluginSetupCompleted = true

        val navController = findNavController()
        if (!navController.popBackStack(R.id.home, false)) {
            navController.navigate(
                R.id.home,
                null,
                NavOptions.Builder()
                    .setPopUpTo(R.id.providers, true)
                    .build()
            )
        }
    }
}
