package com.streamflixreborn.streamflix.fragments.providers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.streamflixreborn.streamflix.plugins.InstalledScraper
import com.streamflixreborn.streamflix.plugins.PluginManager
import com.streamflixreborn.streamflix.plugins.PluginRepository
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.providers.TmdbProvider
import com.streamflixreborn.streamflix.utils.ProviderChangeNotifier
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class RepositoryWithScrapers(
    val repository: PluginRepository,
    val scrapers: List<InstalledScraper>,
)

class ProvidersViewModel : ViewModel() {

    sealed interface UiEvent {
        data class Installed(val repositoryName: String, val scraperCount: Int) : UiEvent
        data class Refreshed(val repositoryName: String) : UiEvent
        data class RefreshedAll(val updatedCount: Int) : UiEvent
        data class Removed(val repositoryName: String) : UiEvent
        data class Error(val message: String) : UiEvent
    }

    private val pluginManager: PluginManager
        get() = PluginManager.getInstance()

    private val _isBusy = MutableStateFlow(false)
    val isBusy: StateFlow<Boolean> = _isBusy.asStateFlow()

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<UiEvent> = _events.asSharedFlow()

    val repositoryItems: StateFlow<List<RepositoryWithScrapers>> = combine(
        pluginManager.repositories,
        pluginManager.scrapers,
    ) { repos, scrapers ->
        val byRepo = scrapers.groupBy { it.repositoryId }
        repos.map { repo ->
            RepositoryWithScrapers(
                repository = repo,
                scrapers = byRepo[repo.id].orEmpty().sortedBy { it.name.lowercase() },
            )
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun installRepository(rawManifestUrl: String) {
        val trimmed = rawManifestUrl.trim()
        if (trimmed.isEmpty()) return
        if (_isBusy.value) return

        viewModelScope.launch {
            _isBusy.value = true
            try {
                val result = pluginManager.addRepository(trimmed)
                result.fold(
                    onSuccess = { repo ->
                        UserPreferences.pluginSetupCompleted = true
                        _events.emit(UiEvent.Installed(repo.name, repo.scraperCount))
                    },
                    onFailure = { error ->
                        _events.emit(
                            UiEvent.Error(
                                error.message ?: "Error al instalar el repositorio manifest.json"
                            )
                        )
                    }
                )
            } finally {
                _isBusy.value = false
            }
        }
    }

    fun refreshRepository(repository: PluginRepository) {
        if (_isBusy.value) return
        viewModelScope.launch {
            _isBusy.value = true
            try {
                pluginManager.refreshRepository(repository.id).fold(
                    onSuccess = { updated ->
                        _events.emit(UiEvent.Refreshed(updated.name))
                    },
                    onFailure = { error ->
                        _events.emit(
                            UiEvent.Error(error.message ?: "Error al actualizar ${repository.name}")
                        )
                    }
                )
            } finally {
                _isBusy.value = false
            }
        }
    }

    fun refreshAllRepositories() {
        if (_isBusy.value) return
        viewModelScope.launch {
            _isBusy.value = true
            try {
                val count = pluginManager.refreshAllRepositories()
                _events.emit(UiEvent.RefreshedAll(count))
            } catch (e: Exception) {
                _events.emit(UiEvent.Error(e.message ?: "Error al actualizar repositorios"))
            } finally {
                _isBusy.value = false
            }
        }
    }

    fun removeRepository(repository: PluginRepository) {
        viewModelScope.launch {
            pluginManager.removeRepository(repository.id)
            _events.emit(UiEvent.Removed(repository.name))
        }
    }

    fun setRepositoryEnabled(repositoryId: String, enabled: Boolean) {
        viewModelScope.launch {
            pluginManager.setRepositoryEnabled(repositoryId, enabled)
        }
    }

    fun setScraperEnabled(uniqueKey: String, enabled: Boolean) {
        viewModelScope.launch {
            pluginManager.setScraperEnabled(uniqueKey, enabled)
        }
    }

    fun selectCatalogLanguage(languageCode: String) {
        val targetProvider = Provider.providers.keys.firstOrNull {
            it is TmdbProvider && it.language == languageCode
        } ?: TmdbProvider(languageCode)

        val changed = UserPreferences.currentProvider?.name != targetProvider.name
        UserPreferences.providerLanguage = languageCode
        UserPreferences.currentProvider = targetProvider
        if (changed) {
            viewModelScope.launch {
                ProviderChangeNotifier.notifyProviderChanged()
            }
        }
    }
}
