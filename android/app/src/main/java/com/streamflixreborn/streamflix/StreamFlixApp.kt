package com.streamflixreborn.streamflix

import android.app.Application
import android.content.Context
import com.streamflixreborn.streamflix.database.AppDatabase
import com.streamflixreborn.streamflix.plugins.PluginManager
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.utils.AppLanguageManager
import com.streamflixreborn.streamflix.utils.ArtworkRepairScheduler
import com.streamflixreborn.streamflix.utils.CacheUtils
import com.streamflixreborn.streamflix.utils.DnsResolver
import com.streamflixreborn.streamflix.utils.IsrgRootTrustProvider
import com.streamflixreborn.streamflix.utils.UserPreferences
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.conscrypt.Conscrypt
import java.security.Security
import java.util.Locale

class StreamFlixApp : Application() {
    companion object {
        lateinit var instance: StreamFlixApp
            private set
    }

    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(AppLanguageManager.wrap(base))
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        Security.insertProviderAt(Conscrypt.newProvider(), 1)
        IsrgRootTrustProvider.install()

        UserPreferences.setup(this)
        DnsResolver.setDnsUrl(UserPreferences.dohProviderUrl)

        val appContext = applicationContext
        PluginManager.initialize(appContext)

        if (UserPreferences.currentProvider == null) {
            UserPreferences.currentProvider =
                Provider.defaultCatalogProvider(Locale.getDefault().language)
        }

        applicationScope.launch(Dispatchers.IO) {
            AppDatabase.setup(appContext)
            ArtworkRepairScheduler.schedule(appContext, UserPreferences.currentProvider)
            CacheUtils.autoClearIfNeeded(appContext, thresholdMb = 50L)
        }
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            CacheUtils.clearAppCache(this)
        }
    }
}
