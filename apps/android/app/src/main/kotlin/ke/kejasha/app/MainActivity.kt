package ke.kejasha.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import dagger.hilt.android.AndroidEntryPoint
import ke.kejasha.app.ui.AppRoot
import ke.kejasha.app.ui.share.SharedText
import ke.kejasha.app.ui.theme.KejashaTheme
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var shared: SharedText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) receive(intent)
        setContent { KejashaTheme { AppRoot() } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        receive(intent)
    }

    private fun receive(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") shared.receive(intent.getStringExtra(Intent.EXTRA_TEXT))
    }
}
