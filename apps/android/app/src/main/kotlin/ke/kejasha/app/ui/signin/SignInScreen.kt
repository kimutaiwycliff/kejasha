package ke.kejasha.app.ui.signin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun SignInScreen(vm: SignInViewModel = hiltViewModel()) {
    val ui by vm.ui.collectAsStateWithLifecycle()
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Kejasha", style = MaterialTheme.typography.headlineLarge)
        Text("Sign in to your account", style = MaterialTheme.typography.bodyLarge)
        PrimaryTabRow(selectedTabIndex = if (ui.byEmail) 1 else 0) {
            Tab(selected = !ui.byEmail, onClick = { vm.edit { copy(byEmail = false) } }, text = { Text("Phone") })
            Tab(selected = ui.byEmail, onClick = { vm.edit { copy(byEmail = true) } }, text = { Text("Email") })
        }
        if (ui.byEmail) EmailForm(ui, vm) else PhoneForm(ui, vm)
        ui.error?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.testTag("signin-error").semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

@Composable
private fun PhoneForm(ui: SignInUi, vm: SignInViewModel) {
    Field(
        label = "Phone number",
        value = ui.phone,
        onChange = { vm.edit { copy(phone = it, codeSent = false) } },
        error = ui.fieldErrors["phone"],
        keyboard = KeyboardType.Phone,
        tag = "phone",
        enabled = !ui.codeSent,
    )
    if (!ui.codeSent) {
        Button(onClick = vm::sendCode, enabled = !ui.busy && ui.phone.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Text(if (ui.busy) "Sending…" else "Send code")
        }
        Text("We'll text you a 6-digit code.", style = MaterialTheme.typography.bodySmall)
    } else {
        Field(
            label = "Code",
            value = ui.code,
            onChange = { vm.edit { copy(code = it.filter(Char::isDigit).take(6)) } },
            error = ui.fieldErrors["code"],
            keyboard = KeyboardType.NumberPassword,
            tag = "code",
        )
        Button(onClick = vm::verify, enabled = !ui.busy && ui.code.length == 6, modifier = Modifier.fillMaxWidth()) {
            Text(if (ui.busy) "Checking…" else "Verify")
        }
        TextButton(onClick = { vm.edit { copy(codeSent = false, code = "") } }) { Text("Use a different number") }
    }
}

@Composable
private fun EmailForm(ui: SignInUi, vm: SignInViewModel) {
    Field("Email", ui.email, { vm.edit { copy(email = it) } }, ui.fieldErrors["email"], KeyboardType.Email, "email")
    Field("Password", ui.password, { vm.edit { copy(password = it) } }, ui.fieldErrors["password"], KeyboardType.Password, "password", secret = true)
    Button(
        onClick = vm::signInEmail,
        enabled = !ui.busy && ui.email.isNotBlank() && ui.password.isNotEmpty(),
        modifier = Modifier.fillMaxWidth(),
    ) { Text(if (ui.busy) "Signing in…" else "Sign in") }
}

@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    error: String?,
    keyboard: KeyboardType,
    tag: String,
    secret: Boolean = false,
    enabled: Boolean = true,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        singleLine = true,
        enabled = enabled,
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Done),
        modifier = Modifier.fillMaxWidth().testTag(tag),
    )
}
