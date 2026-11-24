package ke.kejasha.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ke.kejasha.app.session.Account
import ke.kejasha.app.session.SessionState
import ke.kejasha.app.ui.shell.NoAccessScreen
import ke.kejasha.app.ui.shell.StaffShell
import ke.kejasha.app.ui.shell.TenantShell
import ke.kejasha.app.ui.signin.SignInScreen

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun AppRoot(vm: SessionViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    // testTag → resource-id, so Maestro flows can find elements by id.
    Surface(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
        when (val s = state) {
            SessionState.Loading -> Centered { CircularProgressIndicator() }
            SessionState.SignedOut -> SignInScreen()
            SessionState.UpdateRequired -> Centered {
                Text("Update Kejasha", style = MaterialTheme.typography.headlineSmall)
                Text("This version is no longer supported. Install the latest version from the Play Store.", textAlign = TextAlign.Center)
            }
            is SessionState.Failed -> Centered {
                Text("Couldn't load your account", style = MaterialTheme.typography.headlineSmall)
                Text(s.message, textAlign = TextAlign.Center)
                Button(onClick = { vm.retry() }) { Text("Try again") }
            }
            is SessionState.Ready -> when (val account = s.account) {
                is Account.Staff -> StaffShell(account, s.offline, vm)
                is Account.Tenant -> TenantShell(account, s.offline, vm)
                is Account.NoAccess -> NoAccessScreen(account, vm)
            }
        }
    }
}

@Composable
fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            content()
        }
    }
}
