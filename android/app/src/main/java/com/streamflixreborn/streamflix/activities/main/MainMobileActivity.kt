package com.streamflixreborn.streamflix.activities.main

import android.content.Intent
import android.content.res.ColorStateList
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.viewModels
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.flowWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.NavHostFragment
import androidx.navigation.navOptions
import androidx.navigation.ui.setupWithNavController
import com.streamflixreborn.streamflix.R
import com.streamflixreborn.streamflix.databinding.ActivityMainMobileBinding
import com.streamflixreborn.streamflix.fragments.player.PlayerMobileFragment
import com.streamflixreborn.streamflix.plugins.PluginManager
import com.streamflixreborn.streamflix.providers.Provider
import com.streamflixreborn.streamflix.ui.UpdateAppMobileDialog
import com.streamflixreborn.streamflix.utils.AppLanguageManager
import com.streamflixreborn.streamflix.utils.ProviderChangeNotifier
import com.streamflixreborn.streamflix.utils.ThemeManager
import com.streamflixreborn.streamflix.utils.UserPreferences
import com.streamflixreborn.streamflix.utils.getCurrentFragment
import kotlinx.coroutines.launch
import java.util.Locale

class MainMobileActivity : FragmentActivity() {

    private var _binding: ActivityMainMobileBinding? = null
    private val binding get() = _binding!!

    private val viewModel by viewModels<MainViewModel>()
    private var updateAppDialog: UpdateAppMobileDialog? = null

    override fun attachBaseContext(newBase: android.content.Context) {
        super.attachBaseContext(AppLanguageManager.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(ThemeManager.mobileThemeRes(UserPreferences.selectedTheme))
        super.onCreate(savedInstanceState)

        if (UserPreferences.currentProvider == null) {
            UserPreferences.currentProvider =
                Provider.defaultCatalogProvider(Locale.getDefault().language)
        }

        WindowCompat.setDecorFitsSystemWindows(window, false)
        val palette = ThemeManager.palette(UserPreferences.selectedTheme)
        window.statusBarColor = palette.systemBar
        window.navigationBarColor = palette.systemBar

        _binding = ActivityMainMobileBinding.inflate(layoutInflater)
        setContentView(binding.root)
        applyThemeNavigationChrome()

        ViewCompat.setOnApplyWindowInsetsListener(binding.mainContent) { view, windowInsets ->
            val insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars())
            val navHostFragment =
                supportFragmentManager.findFragmentById(R.id.nav_main_fragment) as? NavHostFragment
            val currentFragment = navHostFragment?.childFragmentManager?.primaryNavigationFragment

            val isPlayer = currentFragment is PlayerMobileFragment
            val isBottomNavVisible = binding.bnvMain.visibility == View.VISIBLE

            val bottomPadding = if (isPlayer || isBottomNavVisible) 0 else insets.bottom
            val topPadding = if (isPlayer) 0 else insets.top

            view.setPadding(insets.left, topPadding, insets.right, bottomPadding)
            windowInsets
        }

        updateImmersiveMode()

        val navHost =
            supportFragmentManager.findFragmentById(R.id.nav_main_fragment) as NavHostFragment
        val navController = navHost.navController

        if (savedInstanceState == null) {
            val hasPlugins = PluginManager.getInstance(this).repositories.value.isNotEmpty()
            if (hasPlugins || UserPreferences.pluginSetupCompleted) {
                navController.navigate(
                    R.id.home,
                    null,
                    navOptions {
                        launchSingleTop = true
                        popUpTo(R.id.providers) {
                            inclusive = true
                        }
                    }
                )
            }
        }

        viewModel.checkUpdate()

        binding.bnvMain.setupWithNavController(navController)
        updateNavigationVisibility()
        updateBottomNavigationVisibility(navController.currentDestination?.id)

        navController.addOnDestinationChangedListener { _, destination, _ ->
            updateNavigationVisibility(destination.id)
            updateBottomNavigationVisibility(destination.id)
            binding.mainContent.post { binding.mainContent.requestApplyInsets() }
        }

        lifecycleScope.launch {
            ProviderChangeNotifier.providerChangeFlow
                .flowWithLifecycle(lifecycle, Lifecycle.State.STARTED)
                .collect {
                    updateNavigationVisibility(navController.currentDestination?.id)
                }
        }

        lifecycleScope.launch {
            viewModel.state.flowWithLifecycle(lifecycle, Lifecycle.State.STARTED).collect { state ->
                when (state) {
                    is MainViewModel.State.SuccessCheckingUpdate -> showUpdateDialog(state)
                    MainViewModel.State.DownloadingUpdate -> updateAppDialog?.isLoading = true
                    is MainViewModel.State.SuccessDownloadingUpdate -> {
                        viewModel.installUpdate(this@MainMobileActivity, state.apk)
                        dismissUpdateDialog()
                    }
                    MainViewModel.State.InstallingUpdate -> updateAppDialog?.isLoading = true
                    is MainViewModel.State.FailedUpdate -> {
                        updateAppDialog?.isLoading = false
                        Toast.makeText(
                            this@MainMobileActivity,
                            state.error.message ?: "Update failed",
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                    else -> {}
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val handled =
                    (getCurrentFragment() as? PlayerMobileFragment)?.onBackPressed() ?: false
                if (handled) return

                val currentDestinationId = navController.currentDestination?.id

                if (currentDestinationId == R.id.settings) {
                    navigateToProviderHome(navController)
                    return
                }

                if (UserPreferences.currentProvider != null && currentDestinationId == R.id.home) {
                    closeTask()
                    return
                }

                if (UserPreferences.currentProvider != null &&
                    isTopLevelProviderDestination(currentDestinationId)
                ) {
                    navigateToProviderHome(navController)
                    return
                }

                if (!navController.navigateUp()) finish()
            }
        })

        if (savedInstanceState == null) {
            handlePluginDeepLink(intent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePluginDeepLink(intent)
    }

    override fun onDestroy() {
        dismissUpdateDialog()
        _binding = null
        super.onDestroy()
    }

    private fun handlePluginDeepLink(intent: Intent) {
        val data = intent.data ?: return
        if (data.scheme.equals("streamflix", ignoreCase = true) &&
            data.host.equals("plugin", ignoreCase = true)
        ) {
            val manifestUrl = data.getQueryParameter("url")?.trim()
            if (!manifestUrl.isNullOrBlank()) {
                lifecycleScope.launch {
                    Toast.makeText(
                        this@MainMobileActivity,
                        "Instalando plugin desde manifest.json…",
                        Toast.LENGTH_SHORT
                    ).show()
                    PluginManager.getInstance(this@MainMobileActivity)
                        .addRepository(manifestUrl)
                        .onSuccess { repo ->
                            UserPreferences.pluginSetupCompleted = true
                            Toast.makeText(
                                this@MainMobileActivity,
                                "Plugin instalado: ${repo.name} (${repo.scraperCount} scrapers)",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                        .onFailure { err ->
                            Toast.makeText(
                                this@MainMobileActivity,
                                "Error al instalar plugin: ${err.message}",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                }
            }
        }
    }

    private fun showUpdateDialog(state: MainViewModel.State.SuccessCheckingUpdate) {
        if (isFinishing || isDestroyed) return

        dismissUpdateDialog()
        updateAppDialog = UpdateAppMobileDialog(this, state.newReleases).also { dialog ->
            dialog.setOnUpdateClickListener {
                if (!dialog.isLoading) {
                    viewModel.downloadUpdate(this@MainMobileActivity, state.asset)
                }
            }
            dialog.show()
        }
    }

    private fun dismissUpdateDialog() {
        updateAppDialog?.takeIf { it.isShowing }?.dismiss()
        updateAppDialog = null
    }

    private fun updateBottomNavigationVisibility(destinationId: Int?) {
        val showBottomNav =
            UserPreferences.currentProvider != null && isTopLevelProviderDestination(destinationId)
        binding.bnvMain.visibility = if (showBottomNav) View.VISIBLE else View.GONE
    }

    private fun updateNavigationVisibility(currentDestinationId: Int? = null) {
        val provider = UserPreferences.currentProvider ?: return
        val supportsMovies = Provider.supportsMovies(provider)
        val supportsTvShows = Provider.supportsTvShows(provider)

        binding.bnvMain.menu.findItem(R.id.movies)?.isVisible = supportsMovies
        binding.bnvMain.menu.findItem(R.id.tv_shows)?.apply {
            isVisible = supportsTvShows
            title = getString(R.string.main_menu_tv_shows)
        }

        val navHost =
            supportFragmentManager.findFragmentById(R.id.nav_main_fragment) as? NavHostFragment
        val navController = navHost?.navController ?: return
        when {
            currentDestinationId == R.id.movies && !supportsMovies -> {
                navController.navigate(R.id.tv_shows)
            }
            currentDestinationId == R.id.tv_shows && !supportsTvShows -> {
                navController.navigate(R.id.home)
            }
        }
    }

    private fun isTopLevelProviderDestination(destinationId: Int?): Boolean {
        return destinationId in setOf(
            R.id.search,
            R.id.home,
            R.id.movies,
            R.id.tv_shows,
            R.id.settings,
        )
    }

    private fun navigateToProviderHome(navController: androidx.navigation.NavController) {
        if (!navController.popBackStack(R.id.home, false)) {
            navController.navigate(
                R.id.home,
                null,
                navOptions {
                    launchSingleTop = true
                    popUpTo(R.id.providers) {
                        inclusive = true
                    }
                }
            )
        }
    }

    private fun closeTask() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            finishAndRemoveTask()
        } else {
            finishAffinity()
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        (getCurrentFragment() as? PlayerMobileFragment)?.onUserLeaveHint()
    }

    fun updateImmersiveMode() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        if (UserPreferences.immersiveMode) {
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    private fun applyThemeNavigationChrome() {
        val palette = ThemeManager.palette(UserPreferences.selectedTheme)
        val navColors = ColorStateList(
            arrayOf(
                intArrayOf(android.R.attr.state_checked),
                intArrayOf(),
            ),
            intArrayOf(
                palette.mobileNavActive,
                palette.mobileNavInactive,
            )
        )

        binding.bnvMain.setBackgroundColor(palette.mobileNavBackground)
        binding.bnvMain.itemIconTintList = navColors
        binding.bnvMain.itemTextColor = navColors

        window.statusBarColor = palette.systemBar
        window.navigationBarColor = palette.systemBar

        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
    }
}
