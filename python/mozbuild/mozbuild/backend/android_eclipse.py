# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

from __future__ import unicode_literals

import itertools
import os
import types
import xml.etree.ElementTree as ET

from mozpack.copier import FileCopier
from mozpack.files import (FileFinder, PreprocessedFile)
from mozpack.manifests import InstallManifest
import mozpack.path as mozpath

from .common import CommonBackend
from ..frontend.data import (
    AndroidEclipseProjectData,
    SandboxDerived,
    SandboxWrapped,
)
from ..makeutil import Makefile
from ..util import ensureParentDir


class AndroidEclipseBackend(CommonBackend):
    """Backend that generates Android Eclipse project files.
    """

    def _init(self):
        CommonBackend._init(self)

        def detailed(summary):
            s = 'Wrote {:d} Android Eclipse projects to {:s}; ' \
                '{:d} created; {:d} updated'.format(
                summary.created_count + summary.updated_count,
                mozpath.join(self.environment.topobjdir, 'android_eclipse'),
                summary.created_count,
                summary.updated_count)

            return s

        # This is a little kludgy and could be improved with a better API.
        self.summary.backend_detailed_summary = types.MethodType(detailed,
            self.summary)

    def consume_object(self, obj):
        """Write out Android Eclipse project files."""

        if not isinstance(obj, SandboxDerived):
            return

        CommonBackend.consume_object(self, obj)

        # If CommonBackend acknowledged the object, we're done with it.
        if obj._ack:
            return

        # We don't want to handle most things, so we just acknowledge all objects...
        obj.ack()

        # ... and handle the one case we care about specially.
        if isinstance(obj, SandboxWrapped) and isinstance(obj.wrapped, AndroidEclipseProjectData):
            self._process_android_eclipse_project_data(obj.wrapped, obj.srcdir, obj.objdir)

    def consume_finished(self):
        """The common backend handles WebIDL and test files. We don't handle
        these, so we don't call our superclass.
        """

    def _Element_for_classpathentry(self, cpe):
        """Turn a ClassPathEntry into an XML Element, like one of:
        <classpathentry including="**/*.java" kind="src" path="preprocessed"/>
        <classpathentry including="**/*.java" excluding="org/mozilla/gecko/Excluded.java|org/mozilla/gecko/SecondExcluded.java" kind="src" path="src"/>
        <classpathentry including="**/*.java" kind="src" path="thirdparty">
            <attributes>
                <attribute name="ignore_optional_problems" value="true"/>
            </attributes>
        </classpathentry>
        """
        e = ET.Element('classpathentry')
        e.set('kind', 'src')
        e.set('including', '**/*.java')
        e.set('path', cpe.path)
        if cpe.exclude_patterns:
            e.set('excluding', '|'.join(sorted(cpe.exclude_patterns)))
        if cpe.ignore_warnings:
            attrs = ET.SubElement(e, 'attributes')
            attr = ET.SubElement(attrs, 'attribute')
            attr.set('name', 'ignore_optional_problems')
            attr.set('value', 'true')
        return e

    def _Element_for_referenced_project(self, name):
        """Turn a referenced project name into an XML Element, like:
        <classpathentry combineaccessrules="false" kind="src" path="/Fennec"/>
        """
        e = ET.Element('classpathentry')
        e.set('kind', 'src')
        e.set('combineaccessrules', 'false')
         # All project directories are in the same root; this
         # reference is absolute in the Eclipse namespace.
        e.set('path', '/' + name)
        return e

    def _Element_for_extra_jar(self, name):
        """Turn a referenced JAR name into an XML Element, like:
        <classpathentry kind="lib" path="libs/robotium-solo-4.3.1.jar"/>
        """
        e = ET.Element('classpathentry')
        e.set('kind', 'lib')
         # All project directories are in the same root; this
         # reference is absolute in the Eclipse namespace.
        e.set('path', 'libs/' + name)
        return e

    def _manifest_for_project(self, srcdir, project):
        manifest = InstallManifest()

        if project.manifest:
            manifest.add_copy(mozpath.join(srcdir, project.manifest), 'AndroidManifest.xml')

        if project.res:
            manifest.add_symlink(mozpath.join(srcdir, project.res), 'res')

        if project.assets:
            manifest.add_symlink(mozpath.join(srcdir, project.assets), 'assets')

        for cpe in project._classpathentries:
            manifest.add_symlink(mozpath.join(srcdir, cpe.srcdir), cpe.dstdir)

        # JARs and native libraries go in the same place. This
        # wouldn't be a problem, except we only know the contents of
        # (a subdirectory of) libs/ after a successful build and
        # package, which is after build-backend time. So we use a
        # pattern symlink that is resolved at manifest install time.
        if project.libs:
            manifest.add_pattern_copy(mozpath.join(srcdir, project.libs), '**', 'libs')

        for extra_jar in sorted(project.extra_jars):
            manifest.add_copy(mozpath.join(srcdir, extra_jar), mozpath.join('libs', os.path.basename(extra_jar)))

        return manifest

    def _process_android_eclipse_project_data(self, data, srcdir, objdir):
        # This can't be relative to the environment's topsrcdir,
        # because during testing topsrcdir is faked.
        template_directory = os.path.abspath(mozpath.join(os.path.dirname(__file__),
            'templates', 'android_eclipse'))

        project_directory = mozpath.join(self.environment.topobjdir, 'android_eclipse', data.name)
        manifest_path = mozpath.join(self.environment.topobjdir, 'android_eclipse', '%s.manifest' % data.name)

        manifest = self._manifest_for_project(srcdir, data)
        ensureParentDir(manifest_path)
        manifest.write(path=manifest_path)

        classpathentries = []
        for cpe in sorted(data._classpathentries, key=lambda x: x.path):
            e = self._Element_for_classpathentry(cpe)
            classpathentries.append(ET.tostring(e))

        for name in sorted(data.referenced_projects):
            e = self._Element_for_referenced_project(name)
            classpathentries.append(ET.tostring(e))

        for name in sorted(data.extra_jars):
            e = self._Element_for_extra_jar(os.path.basename(name))
            classpathentries.append(ET.tostring(e))

        defines = {}
        defines['IDE_OBJDIR'] = objdir
        defines['IDE_TOPOBJDIR'] = self.environment.topobjdir
        defines['IDE_SRCDIR'] = srcdir
        defines['IDE_TOPSRCDIR'] = self.environment.topsrcdir
        defines['IDE_PROJECT_NAME'] = data.name
        defines['IDE_PACKAGE_NAME'] = data.package_name
        defines['IDE_PROJECT_DIRECTORY'] = project_directory
        defines['IDE_RELSRCDIR'] = mozpath.relpath(srcdir, self.environment.topsrcdir)
        defines['IDE_CLASSPATH_ENTRIES'] = '\n'.join('\t' + cpe for cpe in classpathentries)
        defines['IDE_RECURSIVE_MAKE_TARGETS'] = ' '.join(sorted(data.recursive_make_targets))
        # Like android.library=true
        defines['IDE_PROJECT_LIBRARY_SETTING'] = 'android.library=true' if data.is_library else ''
        # Like android.library.reference.1=FennecBrandingResources
        defines['IDE_PROJECT_LIBRARY_REFERENCES'] = '\n'.join(
            'android.library.reference.%s=%s' % (i + 1, ref)
            for i, ref in enumerate(sorted(data.included_projects)))

        copier = FileCopier()
        finder = FileFinder(template_directory)
        for input_filename, f in itertools.chain(finder.find('**'), finder.find('.**')):
            if input_filename == 'AndroidManifest.xml' and not data.is_library:
                # Main projects supply their own manifests.
                continue
            copier.add(input_filename, PreprocessedFile(
                mozpath.join(finder.base, input_filename),
                depfile_path=None,
                marker='#',
                defines=defines,
                extra_depends={mozpath.join(finder.base, input_filename)}))

        # When we re-create the build backend, we kill everything that was there.
        if os.path.isdir(project_directory):
            self.summary.updated_count += 1
        else:
            self.summary.created_count += 1
        copier.copy(project_directory, skip_if_older=False, remove_unaccounted=True)
