package com.mizibu.retfast

import android.app.Activity
import android.app.Application
import android.os.Bundle
import com.mizibu.retfast.app.AppGraph
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** True while at least one activity is started. Used to decide between an in-app prompt and a notification. */
object AppForeground {
    private val _state = MutableStateFlow(false)
    val state: StateFlow<Boolean> = _state
    private var started = 0
    fun register(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) { started++; _state.value = true }
            override fun onActivityStopped(activity: Activity) { started = (started - 1).coerceAtLeast(0); _state.value = started > 0 }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}

class RetfastApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        AppForeground.register(this)
        graph = AppGraph(this)
        graph.start()
    }
}

val android.content.Context.graph: AppGraph get() = (applicationContext as RetfastApp).graph
